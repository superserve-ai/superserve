import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { createFakeClient } from "./fake-client.js"
import { callTool, type ConnectedClient, connect } from "./harness.js"

describe("tool calls (in-memory, fake client)", () => {
  let conn: ConnectedClient

  beforeEach(async () => {
    conn = await connect(createFakeClient().client)
  })
  afterEach(async () => {
    await conn.close()
  })

  async function createSandbox(): Promise<string> {
    const r = await callTool(conn.client, "sandbox_create", { name: "t" })
    return r.structured.id as string
  }

  it("create returns a sandbox id", async () => {
    const r = await callTool(conn.client, "sandbox_create", { name: "t" })
    expect(r.isError).toBe(false)
    expect(r.structured.id).toMatch(/^sbx-/)
    expect(r.structured.status).toBe("active")
  })

  it("exec returns structured stdout and exit code", async () => {
    const id = await createSandbox()
    const r = await callTool(conn.client, "sandbox_exec", {
      sandbox_id: id,
      command: "echo hello",
    })
    expect(r.isError).toBe(false)
    expect(r.structured.stdout).toBe("hello\n")
    expect(r.structured.exit_code).toBe(0)
    expect(r.structured.truncated).toBe(false)
  })

  it("write then read round-trips file content", async () => {
    const id = await createSandbox()
    await callTool(conn.client, "sandbox_files_write", {
      sandbox_id: id,
      path: "/app/data.txt",
      content: "hello world",
    })
    const r = await callTool(conn.client, "sandbox_files_read", {
      sandbox_id: id,
      path: "/app/data.txt",
    })
    expect(r.structured.content).toBe("hello world")
    expect(r.structured.encoding).toBe("text")
    expect(r.structured.bytes).toBe(11)
  })

  it("round-trips binary content via base64", async () => {
    const id = await createSandbox()
    const b64 = Buffer.from([0, 1, 2, 255]).toString("base64")
    await callTool(conn.client, "sandbox_files_write", {
      sandbox_id: id,
      path: "/app/bin",
      content: b64,
      encoding: "base64",
    })
    const r = await callTool(conn.client, "sandbox_files_read", {
      sandbox_id: id,
      path: "/app/bin",
      encoding: "base64",
    })
    expect(r.structured.content).toBe(b64)
  })

  it("files_list returns directory entries", async () => {
    const id = await createSandbox()
    await callTool(conn.client, "sandbox_files_write", {
      sandbox_id: id,
      path: "/app/a.txt",
      content: "a",
    })
    await callTool(conn.client, "sandbox_files_write", {
      sandbox_id: id,
      path: "/app/b.txt",
      content: "bb",
    })
    const r = await callTool(conn.client, "sandbox_files_list", {
      sandbox_id: id,
      path: "/app",
    })
    const entries = r.structured.entries as Array<{ name: string }>
    expect(entries.map((e) => e.name).toSorted()).toEqual(["a.txt", "b.txt"])
  })

  it("info is read-only and returns details", async () => {
    const id = await createSandbox()
    const r = await callTool(conn.client, "sandbox_info", { sandbox_id: id })
    expect(r.structured.id).toBe(id)
    expect(r.structured.vcpu_count).toBe(2)
    expect(typeof r.structured.created_at).toBe("string")
  })

  it("pause then resume updates status", async () => {
    const id = await createSandbox()
    const paused = await callTool(conn.client, "sandbox_pause", {
      sandbox_id: id,
    })
    expect(paused.structured.status).toBe("paused")
    const resumed = await callTool(conn.client, "sandbox_resume", {
      sandbox_id: id,
    })
    expect(resumed.structured.status).toBe("active")
  })

  it("kill is idempotent", async () => {
    const id = await createSandbox()
    const first = await callTool(conn.client, "sandbox_kill", {
      sandbox_id: id,
    })
    expect(first.structured.deleted).toBe(true)
    const second = await callTool(conn.client, "sandbox_kill", {
      sandbox_id: id,
    })
    expect(second.isError).toBe(false)
    expect(second.structured.deleted).toBe(true)
  })

  it("unknown sandbox yields an actionable isError result", async () => {
    const r = await callTool(conn.client, "sandbox_exec", {
      sandbox_id: "does-not-exist",
      command: "echo hi",
    })
    expect(r.isError).toBe(true)
    expect(r.text).toMatch(/not found/i)
    expect(r.text).toMatch(/sandbox_list/)
  })
})
