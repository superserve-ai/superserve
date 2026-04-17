import { describe, it, expect, beforeAll, afterAll } from "vitest"
import type { SuperserveClient } from "@superserve/sdk"
import { createClient, hasCredentials, RUN_ID } from "../src/client.js"
import { waitForStatus } from "../src/polling.js"

describe.skipIf(!hasCredentials())("sandboxes", () => {
  const name = `sdk-e2e-sandbox-${RUN_ID}`
  let client: SuperserveClient
  let sandboxId: string

  beforeAll(async () => {
    client = createClient()
    const sandbox = await client.sandboxes.createSandbox({ name })
    if (!sandbox.id) {
      throw new Error("createSandbox did not return an id")
    }
    sandboxId = sandbox.id
    await waitForStatus(client, sandboxId, "active")
  })

  afterAll(async () => {
    if (!sandboxId) return
    try {
      await client.sandboxes.deleteSandbox({ sandbox_id: sandboxId })
    } catch (err) {
      // Non-fatal: log and let the test run finish. Orphaned sandboxes
      // carry the RUN_ID in their name for manual cleanup if needed.
      console.error(`Cleanup failed for sandbox ${sandboxId}:`, err)
    }
  })

  it("getSandbox returns the created sandbox", async () => {
    const sandbox = await client.sandboxes.getSandbox({ sandbox_id: sandboxId })
    expect(sandbox.id).toBe(sandboxId)
    expect(sandbox.name).toBe(name)
    expect(sandbox.status).toBe("active")
  })

  it("listSandboxes includes our sandbox", async () => {
    const list = await client.sandboxes.listSandboxes()
    const ids = list.map((s) => s.id)
    expect(ids).toContain(sandboxId)
  })

  it("patchSandbox accepts metadata updates", async () => {
    await client.sandboxes.patchSandbox({
      sandbox_id: sandboxId,
      metadata: {
        env: "test",
        "run-id": RUN_ID,
      },
    })
    // The API may or may not return metadata on GET — we verify the
    // patch completed without error and the sandbox is still reachable.
    const sandbox = await client.sandboxes.getSandbox({ sandbox_id: sandboxId })
    expect(sandbox.id).toBe(sandboxId)
  })

  it("pauses the sandbox and transitions to paused", async () => {
    await client.sandboxes.pauseSandbox({ sandbox_id: sandboxId })
    // Backend may return "paused" or "idle" depending on version — spec drift.
    const paused = await waitForStatus(client, sandboxId, ["paused", "idle"], {
      timeoutMs: 90_000,
    })
    expect(["paused", "idle"]).toContain(paused.status)
  }, 120_000)

  it("resumes the sandbox and transitions back to active", async () => {
    await client.sandboxes.resumeSandbox({ sandbox_id: sandboxId })
    const resumed = await waitForStatus(client, sandboxId, "active", {
      timeoutMs: 90_000,
    })
    expect(resumed.status).toBe("active")
  }, 120_000)
})
