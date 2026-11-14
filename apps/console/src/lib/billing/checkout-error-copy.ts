import { ApiError } from "@/lib/api/client"

const GENERIC =
  "Something went wrong on our side. Try again in a few minutes. If it keeps happening, contact support@superserve.ai."

const PROXY_COPY_CODES = new Set([
  "plan_team_changed",
  "signup_review_pending",
  "signup_blocked",
  "read_only_impersonation",
  "authentication_unavailable",
])

export function checkoutErrorMessage(cause: unknown): string {
  if (cause instanceof ApiError) {
    if (PROXY_COPY_CODES.has(cause.code)) return cause.message || GENERIC
    if (cause.status === 401 || cause.code === "unauthorized")
      return "Your session expired. Sign in again to continue."
    if (cause.code === "invalid_offer")
      return "That plan isn't available for this team now. Reload the page and choose a plan again."
    if (cause.code === "checkout_rejected")
      return "Checkout couldn't start. Choose your plan again."
    if (cause.code === "plan_conflict")
      return "A plan or payment for this team is already in progress. Check your payment status before you try again."
    if (cause.status === 403)
      return "You can't change the plan for this team. Ask a team billing administrator, or contact support@superserve.ai."
    if (cause.status === 429)
      return "Too many attempts. Wait a minute, then try again."
    return GENERIC
  }
  if (cause instanceof Error) {
    if ("digest" in cause) return GENERIC
    if (
      cause instanceof TypeError ||
      cause instanceof SyntaxError ||
      cause.name === "AbortError" ||
      cause.name === "TimeoutError"
    )
      return "We couldn't reach Superserve. Check your connection, then try again."
    return cause.message || GENERIC
  }
  return GENERIC
}
