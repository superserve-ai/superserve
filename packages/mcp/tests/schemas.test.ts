import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { createFakeClient } from "./fake-client.js"
import { type ConnectedClient, connect } from "./harness.js"

const EXPECTED_TOOLS = [
  "sandbox_create",
  "sandbox_list",
  "sandbox_info",
  "sandbox_exec",
  "sandbox_files_read",
  "sandbox_files_write",
  "sandbox_files_list",
  "sandbox_pause",
  "sandbox_resume",
  "sandbox_kill",
]

const PER_SANDBOX_TOOLS = [
  "sandbox_info",
  "sandbox_exec",
  "sandbox_files_read",
  "sandbox_files_write",
  "sandbox_files_list",
  "sandbox_pause",
  "sandbox_resume",
  "sandbox_kill",
]

describe("tool registration", () => {
  let conn: ConnectedClient
  // biome-ignore lint: vitest lifecycle
  let tools: Array<Record<string, any>>

  beforeEach(async () => {
    conn = await connect(createFakeClient().client)
    const res = await conn.client.listTools()
    tools = res.tools as Array<Record<string, any>>
  })
  afterEach(async () => {
    await conn.close()
  })

  const byName = (name: string) => tools.find((t) => t.name === name)

  it("registers exactly the v1 tool set", () => {
    expect(tools.map((t) => t.name).toSorted()).toEqual(
      EXPECTED_TOOLS.toSorted(),
    )
  })

  it("every tool has a non-empty description and input schema", () => {
    for (const t of tools) {
      expect(typeof t.description).toBe("string")
      expect(t.description.length).toBeGreaterThan(0)
      expect(t.inputSchema).toBeDefined()
    }
  })

  it("per-sandbox tools require sandbox_id", () => {
    for (const name of PER_SANDBOX_TOOLS) {
      const t = byName(name)
      expect(t?.inputSchema?.required ?? []).toContain("sandbox_id")
    }
  })

  it("declares honest read-only / destructive / idempotent hints", () => {
    expect(byName("sandbox_list")?.annotations?.readOnlyHint).toBe(true)
    expect(byName("sandbox_info")?.annotations?.readOnlyHint).toBe(true)
    expect(byName("sandbox_files_read")?.annotations?.readOnlyHint).toBe(true)
    expect(byName("sandbox_files_list")?.annotations?.readOnlyHint).toBe(true)

    expect(byName("sandbox_exec")?.annotations?.readOnlyHint).toBe(false)
    expect(byName("sandbox_create")?.annotations?.readOnlyHint).toBe(false)

    expect(byName("sandbox_kill")?.annotations?.destructiveHint).toBe(true)
    expect(byName("sandbox_kill")?.annotations?.idempotentHint).toBe(true)
    expect(byName("sandbox_pause")?.annotations?.idempotentHint).toBe(true)
    expect(byName("sandbox_files_write")?.annotations?.idempotentHint).toBe(
      true,
    )
  })
})
