/**
 * Map Superserve SDK typed errors to short, actionable messages for tool
 * results. The model sees these strings, so they should tell it what to do
 * next — never leak credentials or internal detail.
 */

import {
  AuthenticationError,
  BillingError,
  ConflictError,
  NotFoundError,
  RateLimitError,
  SandboxError,
  ServerError,
  TimeoutError,
  ValidationError,
} from "@superserve/sdk"

function formatBillingError(err: BillingError): string {
  const where = err.actionUrl
    ? `at ${err.actionUrl}`
    : "in the Superserve console"
  const keep =
    "This block does not delete sandboxes, but a sandbox set to auto-delete after a pause can still be deleted. Other existing sandboxes stay paused until a plan is active."
  if (err.code === "trial_exhausted") {
    return `The free trial credit is used up. Do not retry. Ask the user to add a card and choose a plan ${where}. ${keep}`
  }
  if (err.code === "trial_unavailable") {
    return `The free trial is not available for this account. Do not retry. Ask the user to add a card and choose a plan ${where}. ${keep}`
  }
  if (err.code === "trial_check_unavailable") {
    return `The free trial could not be confirmed because a required check did not complete. Do not retry in a loop. Ask the user to add a card and choose a plan ${where}, or contact support@superserve.ai. ${keep}`
  }
  if (
    err.code === "free_allowance_exhausted" ||
    err.code === "sandbox_exceeds_plan_limits"
  ) {
    return err.message
  }
  // Preserve the server's explanation; add guidance without specific claims.
  const message = err.message.trim() || "Billing does not allow this request."
  return `${message}${/[.!?]$/.test(message) ? "" : "."} Do not retry. Ask the user to check their billing ${where}.`
}

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
  if (err instanceof BillingError) {
    return formatBillingError(err)
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

/**
 * The error's own message, without retry guidance. For operations that are
 * not idempotent, the caller decides what to do next, so this must not
 * suggest a replay the way `formatSdkError` does for server errors.
 */
export function describeSdkError(err: unknown): string {
  if (err instanceof ServerError) return err.message
  return formatSdkError(err)
}
