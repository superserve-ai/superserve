/**
 * Live exec round-trip. Skipped unless SUPERSERVE_API_KEY is set (same gate as
 * the SDK e2e suite). Run via `bunx turbo run e2e --filter=@superserve/mcp`.
 */

import { afterAll, describe, expect, it } from "vitest"

import { createSdkClient } from "../src/client.js"
import { resolveClientConfig } from "../src/config.js"
import { callTool, connect } from "./harness.js"

const hasKey = Boolean(process.env.SUPERSERVE_API_KEY)

describe.skipIf(!hasKey)("live exec round-trip", () => {
  let sandboxId: string | undefined
  let close: (() => Promise<void>) | undefined

  afterAll(async () => {
    if (sandboxId && close) {
      // Best-effort cleanup handled inside the test's finally; nothing here.
    }
  })

  it("create → exec → write → read → list → pause → exec(auto-resume) → kill", async () => {
    const conn = await connect(createSdkClient(resolveClientConfig()))
    close = conn.close
    try {
      const created = await callTool(conn.client, "sandbox_create", {
        name: "mcp-e2e",
      })
      expect(created.isError).toBe(false)
      sandboxId = created.structured.id as string
      expect(sandboxId).toBeTruthy()

      const echoed = await callTool(conn.client, "sandbox_exec", {
        sandbox_id: sandboxId,
        command: "echo hello-mcp",
      })
      expect(echoed.structured.exit_code).toBe(0)
      expect(String(echoed.structured.stdout)).toContain("hello-mcp")

      await callTool(conn.client, "sandbox_files_write", {
        sandbox_id: sandboxId,
        path: "/tmp/mcp-e2e.txt",
        content: "roundtrip",
      })
      const read = await callTool(conn.client, "sandbox_files_read", {
        sandbox_id: sandboxId,
        path: "/tmp/mcp-e2e.txt",
      })
      expect(read.structured.content).toBe("roundtrip")

      const listed = await callTool(conn.client, "sandbox_files_list", {
        sandbox_id: sandboxId,
        path: "/tmp",
      })
      const names = (listed.structured.entries as Array<{ name: string }>).map(
        (e) => e.name,
      )
      expect(names).toContain("mcp-e2e.txt")

      await callTool(conn.client, "sandbox_pause", { sandbox_id: sandboxId })

      // Exec on a paused sandbox must transparently auto-resume.
      const afterPause = await callTool(conn.client, "sandbox_exec", {
        sandbox_id: sandboxId,
        command: "echo resumed",
      })
      expect(afterPause.structured.exit_code).toBe(0)
      expect(String(afterPause.structured.stdout)).toContain("resumed")
    } finally {
      if (sandboxId) {
        await callTool(conn.client, "sandbox_kill", { sandbox_id: sandboxId })
      }
      await conn.close()
    }
  }, 120_000)

  it("create → write files in a dir → download_dir returns a real zip → kill", async () => {
    const conn = await connect(createSdkClient(resolveClientConfig()))
    let id: string | undefined
    try {
      const created = await callTool(conn.client, "sandbox_create", {
        name: "mcp-e2e-dl",
      })
      expect(created.isError).toBe(false)
      id = created.structured.id as string
      expect(id).toBeTruthy()

      await callTool(conn.client, "sandbox_files_write", {
        sandbox_id: id,
        path: "/tmp/mcp-dldir/hello.txt",
        content: "hello-zip",
      })
      await callTool(conn.client, "sandbox_files_write", {
        sandbox_id: id,
        path: "/tmp/mcp-dldir/world.txt",
        content: "world-zip",
      })

      const dl = await callTool(conn.client, "sandbox_files_download_dir", {
        sandbox_id: id,
        path: "/tmp/mcp-dldir",
      })
      expect(dl.isError).toBe(false)
      expect(dl.structured.format).toBe("zip")
      expect(dl.structured.encoding).toBe("base64")
      expect(dl.structured.bytes as number).toBeGreaterThan(0)

      const zip = Buffer.from(dl.structured.content as string, "base64")
      // A real ZIP starts with the local-file-header magic "PK\x03\x04".
      expect([...zip.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04])
      // ZIP stores entry filenames uncompressed in the local file header.
      const raw = zip.toString("latin1")
      expect(raw).toContain("hello.txt")
      expect(raw).toContain("world.txt")
    } finally {
      if (id) await callTool(conn.client, "sandbox_kill", { sandbox_id: id })
      await conn.close()
    }
  }, 120_000)
})
