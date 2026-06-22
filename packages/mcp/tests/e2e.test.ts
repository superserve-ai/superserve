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
})
