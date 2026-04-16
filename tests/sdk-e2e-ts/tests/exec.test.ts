import { describe, it, expect, beforeAll, afterAll } from "vitest"
import type { SuperserveClient } from "@superserve/sdk"
import { createClient, hasCredentials, RUN_ID } from "../src/client.js"
import { waitForStatus } from "../src/polling.js"

describe.skipIf(!hasCredentials())("exec", () => {
  const name = `sdk-e2e-exec-${RUN_ID}`
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
      console.error(`Cleanup failed for sandbox ${sandboxId}:`, err)
    }
  })

  it("command runs a sync command and returns stdout + exit code", async () => {
    const result = await client.exec.command({
      sandbox_id: sandboxId,
      body: { command: "echo hello-from-e2e" },
    })
    expect(result.stdout).toContain("hello-from-e2e")
    expect(result.exit_code).toBe(0)
  })

  it("command returns a non-zero exit code for failing commands", async () => {
    const result = await client.exec.command({
      sandbox_id: sandboxId,
      body: { command: "exit 42" },
    })
    expect(result.exit_code).toBe(42)
  })

  it("commandStream streams events and finishes with an exit code", async () => {
    const stream = await client.exec.commandStream({
      sandbox_id: sandboxId,
      body: {
        command: "for i in 1 2 3; do echo line-$i; sleep 0.1; done",
      },
    })

    const stdoutChunks: string[] = []
    let finished = false
    let exitCode: number | undefined

    for await (const event of stream) {
      if (event.stdout) stdoutChunks.push(event.stdout)
      if (event.finished) {
        finished = true
        exitCode = event.exit_code
      }
    }

    const combined = stdoutChunks.join("")
    expect(finished).toBe(true)
    expect(exitCode).toBe(0)
    expect(combined).toContain("line-1")
    expect(combined).toContain("line-2")
    expect(combined).toContain("line-3")
  })
})
