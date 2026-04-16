/**
 * Polling utility for waiting on sandbox status transitions.
 *
 * Used internally by Sandbox.create() (wait for active) and can be
 * called directly via sandbox.waitForReady().
 */

import { TimeoutError } from "./errors.js"
import { request } from "./http.js"
import type { ApiSandboxResponse, SandboxInfo, SandboxStatus } from "./types.js"
import { toSandboxInfo } from "./types.js"

interface WaitOptions {
  /** Maximum wait time in ms. Default 60_000 (60s). */
  timeoutMs?: number
  /** Poll interval in ms. Default 1_000 (1s). */
  intervalMs?: number
}

/**
 * Poll `GET /sandboxes/{id}` until status matches `target`.
 *
 * Uses linear polling (not exponential) — sandbox boot is typically 2-5s,
 * so 1s intervals hit the sweet spot between responsiveness and API load.
 *
 * @returns The SandboxInfo once the target status is reached.
 * @throws TimeoutError if the deadline elapses.
 */
export async function waitForStatus(
  sandboxId: string,
  target: SandboxStatus,
  baseUrl: string,
  apiKey: string,
  opts: WaitOptions = {},
): Promise<SandboxInfo> {
  const { timeoutMs = 60_000, intervalMs = 1_000 } = opts
  const deadline = Date.now() + timeoutMs
  let lastStatus: string | undefined

  while (Date.now() < deadline) {
    const raw = await request<ApiSandboxResponse>({
      method: "GET",
      url: `${baseUrl}/sandboxes/${sandboxId}`,
      headers: { "X-API-Key": apiKey },
    })
    lastStatus = raw.status
    if (raw.status === target) {
      return toSandboxInfo(raw)
    }
    await sleep(intervalMs)
  }

  throw new TimeoutError(
    `Timed out after ${timeoutMs}ms waiting for sandbox ${sandboxId} ` +
      `to reach "${target}". Last status: "${lastStatus ?? "unknown"}".`,
  )
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
