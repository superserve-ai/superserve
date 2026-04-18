/**
 * Polling utility for waiting on sandbox status transitions.
 */

import { SandboxError, TimeoutError } from "./errors.js"
import { request } from "./http.js"
import type {
  ApiSandboxResponse,
  SandboxInfo,
  SandboxStatus,
  SandboxWaitOptions,
} from "./types.js"
import { toSandboxInfo } from "./types.js"

/**
 * Poll GET /sandboxes/{id} until status matches `target`.
 *
 * Bails early if the sandbox reaches a terminal status (`failed` or `deleted`)
 * that isn't the target.
 *
 * @throws TimeoutError if the deadline elapses.
 * @throws SandboxError if the sandbox reaches a terminal failed/deleted state.
 */
export async function waitForStatus(
  sandboxId: string,
  target: SandboxStatus,
  baseUrl: string,
  apiKey: string,
  opts: SandboxWaitOptions = {},
): Promise<SandboxInfo> {
  const { timeoutMs = 60_000, intervalMs = 1_000, signal } = opts
  const deadline = Date.now() + timeoutMs
  let lastStatus: string | undefined

  while (Date.now() < deadline) {
    if (signal?.aborted) {
      throw new SandboxError("Polling aborted")
    }

    const raw = await request<ApiSandboxResponse>({
      method: "GET",
      url: `${baseUrl}/sandboxes/${sandboxId}`,
      headers: { "X-API-Key": apiKey },
      signal,
    })
    lastStatus = raw.status
    if (raw.status === target) {
      return toSandboxInfo(raw)
    }
    // Fail fast on terminal states
    if (target !== "failed" && raw.status === "failed") {
      throw new SandboxError(
        `Sandbox ${sandboxId} reached "failed" state before "${target}"`,
      )
    }
    if (target !== "deleted" && raw.status === "deleted") {
      throw new SandboxError(
        `Sandbox ${sandboxId} was deleted while waiting for "${target}"`,
      )
    }

    // Linear poll with ±20% jitter
    const jitter = intervalMs * (0.8 + Math.random() * 0.4)
    await sleep(jitter)
  }

  throw new TimeoutError(
    `Timed out after ${timeoutMs}ms waiting for sandbox ${sandboxId} ` +
      `to reach "${target}". Last status: "${lastStatus ?? "unknown"}".`,
  )
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
