/**
 * Polling helper used to wait for a sandbox to reach a target status.
 *
 * Lifecycle transitions (starting → active, active → pausing → idle,
 * idle → starting → active on resume) aren't instantaneous, so tests
 * that exercise these transitions poll `getSandbox` until the expected
 * status is observed or the timeout elapses.
 */

import type { SuperserveClient } from "@superserve/sdk"

/** Known sandbox lifecycle statuses. */
export type SandboxStatus =
  | "starting"
  | "active"
  | "pausing"
  | "idle"
  | "deleted"

interface WaitOptions {
  /** Maximum total time to wait, in milliseconds. Default 60s. */
  timeoutMs?: number
  /** Interval between polls, in milliseconds. Default 2s. */
  intervalMs?: number
}

/**
 * Poll `getSandbox` until the sandbox reaches `expected` status, or throw.
 * Returns the final sandbox response so callers can assert on its fields.
 */
export async function waitForStatus(
  client: SuperserveClient,
  sandboxId: string,
  expected: SandboxStatus,
  { timeoutMs = 60_000, intervalMs = 2_000 }: WaitOptions = {},
) {
  const deadline = Date.now() + timeoutMs
  let lastStatus: string | undefined

  while (Date.now() < deadline) {
    const sandbox = await client.sandboxes.getSandbox({ sandbox_id: sandboxId })
    lastStatus = sandbox.status
    if (sandbox.status === expected) {
      return sandbox
    }
    await sleep(intervalMs)
  }

  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for sandbox ${sandboxId} to reach ` +
    `status "${expected}". Last observed status: "${lastStatus ?? "unknown"}".`
  )
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
