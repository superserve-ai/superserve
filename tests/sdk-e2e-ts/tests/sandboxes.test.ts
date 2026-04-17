import type { SandboxInfo } from "@superserve/sdk"
import { Sandbox } from "@superserve/sdk"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { connectionOptions, hasCredentials, RUN_ID } from "../src/client.js"

describe.skipIf(!hasCredentials())("sandboxes", () => {
  const name = `sdk-e2e-sandbox-${RUN_ID}`
  let sandbox: Sandbox
  const opts = hasCredentials()
    ? connectionOptions()
    : { apiKey: "", baseUrl: "" }

  beforeAll(async () => {
    sandbox = await Sandbox.create({ name, ...opts })
    await sandbox.waitForReady()
  })

  afterAll(async () => {
    if (!sandbox?.id) return
    try {
      await sandbox.kill()
    } catch (err) {
      console.error(`Cleanup failed for sandbox ${sandbox.id}:`, err)
    }
  })

  it("getInfo returns the created sandbox", async () => {
    const info = await sandbox.getInfo()
    expect(info.id).toBe(sandbox.id)
    expect(info.name).toBe(name)
    expect(info.status).toBe("active")
  })

  it("list includes our sandbox", async () => {
    const list = await Sandbox.list(opts)
    const ids = list.map((s: SandboxInfo) => s.id)
    expect(ids).toContain(sandbox.id)
  })

  it("update accepts metadata", async () => {
    await sandbox.update({
      metadata: { env: "test", "run-id": RUN_ID },
    })
    const info = await sandbox.getInfo()
    expect(info.id).toBe(sandbox.id)
  })

  it("pauses and transitions to idle/paused", async () => {
    await sandbox.pause()
    // Backend may return "paused" or "idle" depending on version — spec drift.
    const maxWait = Date.now() + 90_000
    while (Date.now() < maxWait) {
      const info = await sandbox.getInfo()
      if (info.status === "idle" || (info.status as string) === "paused") {
        expect(["paused", "idle"]).toContain(info.status)
        return
      }
      await new Promise((r) => setTimeout(r, 2000))
    }
    throw new Error("Timed out waiting for paused/idle status")
  }, 120_000)

  it("resumes back to active", async () => {
    await sandbox.resume()
    const maxWait = Date.now() + 90_000
    while (Date.now() < maxWait) {
      const info = await sandbox.getInfo()
      if (info.status === "active") {
        expect(info.status).toBe("active")
        return
      }
      await new Promise((r) => setTimeout(r, 2000))
    }
    throw new Error("Timed out waiting for active status")
  }, 120_000)
})
