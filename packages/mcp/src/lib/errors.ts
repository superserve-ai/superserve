/**
 * Map Superserve SDK typed errors to short, actionable messages for tool
 * results. The model sees these strings, so they should tell it what to do
 * next — never leak credentials or internal detail.
 */

import {
  AuthenticationError,
  ConflictError,
  NotFoundError,
  RateLimitError,
  SandboxError,
  ServerError,
  TimeoutError,
  ValidationError,
} from "@superserve/sdk"

export function formatSdkError(err: unknown): string {
  if (err instanceof AuthenticationError) {
    return "Authentication failed. Check that SUPERSERVE_API_KEY is set to a valid key (starts with `ss_live_`)."
  }
  if (err instanceof NotFoundError) {
    return `${err.message}. Use sandbox_list to see existing sandboxes, or sandbox_create to make one.`
  }
  if (err instanceof ValidationError) {
    return `Invalid request: ${err.message}`
  }
  if (err instanceof ConflictError) {
    return `Sandbox is in a conflicting state: ${err.message}. Re-check with sandbox_info.`
  }
  if (err instanceof RateLimitError) {
    if (err.code === "too_many_sandboxes") {
      return "Sandbox quota reached. Pause or kill a sandbox (sandbox_list / sandbox_kill), or retry later."
    }
    return `Rate limited: ${err.message}. Retry after a short backoff.`
  }
  if (err instanceof TimeoutError) {
    // The SDK's TimeoutError carries only a message — no partial stdout/stderr —
    // so there is nothing more to surface here. Returning partial captured
    // output would require the SDK to attach it to TimeoutError first (follow-up).
    return err.message
  }
  if (err instanceof ServerError) {
    return "Superserve server error. This is usually transient — safe to retry."
  }
  if (err instanceof SandboxError) {
    return err.message
  }
  if (err instanceof Error) {
    return err.message
  }
  return "Unexpected error."
}
