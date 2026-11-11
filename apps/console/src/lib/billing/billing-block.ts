import type {
  BillingSummaryResponse,
  BillingTrialBlock,
} from "@/lib/api/billing"
import { ApiError } from "@/lib/api/client"

import { legacyBillingUsagePath } from "./legacy-billing-usage-path"

// Where a billing block sends the user when the server gives no usable link.
// The dashboard layout forwards a team that awaits a plan to the plan picker.
export const BILLING_BLOCK_FALLBACK_PATH = "/billing-usage/"

export const BILLING_BLOCK_ACTION_LABEL = "Add card / choose plan"

// Tracking names for the three trial cases plus every other billing block.
// They stay separate so a denial, a used-up trial and a failed check never
// count as the same thing.
export type BillingBlockReason =
  | "trial_denied"
  | "trial_used_up"
  | "system_unavailable"
  | "billing_inactive"

export type BillingBlockSurface = "create" | "resume" | "terminal" | "activity"

export interface BillingBlock {
  code: string
  reason: BillingBlockReason
  title: string
  description: string
  href: string
}

// The 402 codes that a card or a plan resolves. Other 402s, such as the Free
// plan's daily allowance (`free_allowance_exhausted`) or a template larger
// than the plan (`sandbox_exceeds_plan_limits`), have a different next step
// and keep their own error path.
export type BillingBlockCode = BillingTrialBlock | "billing_ineligible"

const BLOCK_REASONS: Record<BillingBlockCode, BillingBlockReason> = {
  trial_unavailable: "trial_denied",
  trial_exhausted: "trial_used_up",
  trial_check_unavailable: "system_unavailable",
  billing_ineligible: "billing_inactive",
}

function isBillingBlockCode(code: string): code is BillingBlockCode {
  return Object.hasOwn(BLOCK_REASONS, code)
}

const TITLES: Record<BillingBlockReason, string> = {
  trial_denied: "Free trial not available",
  trial_used_up: "Free trial credit used up",
  system_unavailable: "Free trial not confirmed",
  billing_inactive: "Billing action needed",
}

// Used only when the server sends no message. Each one keeps the server's
// wording for that code.
const DEFAULT_DESCRIPTIONS: Record<BillingBlockReason, string> = {
  trial_denied:
    "The free trial is not available for this account. Add a card and choose a plan to use sandboxes.",
  trial_used_up:
    "Your free trial credit is used up. Add a card and choose a plan to keep using sandboxes.",
  system_unavailable:
    "We could not confirm the free trial for this account because a required check did not complete. Add a card and choose a plan to use sandboxes.",
  billing_inactive: "Sandbox usage is unavailable until billing is active.",
}

/** The tracking reason for a billing block code, or null for any other code. */
export function billingBlockReason(code: string): BillingBlockReason | null {
  return isBillingBlockCode(code) ? BLOCK_REASONS[code] : null
}

function currentOrigin(): string | null {
  return typeof window === "undefined" ? null : window.location.origin
}

/**
 * A console path for the server's `action_url`. Only a relative path or a URL
 * on the console's own origin is used; anything else gives the fallback. The
 * old `/plan-usage` paths map to `/billing-usage`.
 */
export function safeBillingActionHref(
  actionUrl: unknown,
  origin: string | null = currentOrigin(),
): string {
  if (typeof actionUrl !== "string") return BILLING_BLOCK_FALLBACK_PATH
  const raw = actionUrl.trim()
  // Backslashes and control characters let a "relative" path change origin
  // in some URL parsers, so they never count as a console path.
  // oxlint-disable-next-line no-control-regex
  if (!raw || /[\\\u0000-\u001f\u007f]/.test(raw))
    return BILLING_BLOCK_FALLBACK_PATH
  const relative = raw.startsWith("/") && !raw.startsWith("//")
  if (!relative && !origin) return BILLING_BLOCK_FALLBACK_PATH
  let url: URL
  try {
    url = relative
      ? new URL(raw, origin ?? "https://console.invalid")
      : new URL(raw)
  } catch {
    return BILLING_BLOCK_FALLBACK_PATH
  }
  if (!relative && url.origin !== origin) return BILLING_BLOCK_FALLBACK_PATH
  if (url.pathname.startsWith("/api/") || url.pathname === "/api")
    return BILLING_BLOCK_FALLBACK_PATH
  const pathname = legacyBillingUsagePath(url.pathname) ?? url.pathname
  // Dot segments and doubled slashes can normalize to "//host", which the
  // browser reads as another origin.
  if (pathname.startsWith("//")) return BILLING_BLOCK_FALLBACK_PATH
  // The app uses trailing slashes; asking for one directly saves a redirect.
  const path = pathname.endsWith("/") ? pathname : `${pathname}/`
  const href = `${path}${url.search}${url.hash}`
  // The result must still resolve to the console itself.
  const base = origin ?? "https://console.invalid"
  if (new URL(href, base).origin !== new URL(base).origin)
    return BILLING_BLOCK_FALLBACK_PATH
  return href
}

const BLOCKED_PLAN_STATES = new Set([
  "trial_ended",
  "payment_failed",
  "plan_required",
  "payment_method_required",
])

/**
 * The summary shows a billing reason that the team cannot run sandboxes:
 * a trial block, a plan state that needs payment, or no credit and no
 * subscription in live billing (this covers a used-up legacy trial).
 */
export function billingStillBlocked(
  summary: BillingSummaryResponse | undefined,
): boolean {
  if (!summary) return false
  return (
    !!summary.trial_block ||
    BLOCKED_PLAN_STATES.has(summary.plan?.status ?? "") ||
    summary.payment_setup_required === true
  )
}

/**
 * The summary shows that the team can run sandboxes: no block, and either
 * trial or prepaid credit the server marks eligible, or an active contract.
 * A summary with no reason either way is not proof: the server keeps some
 * blocks generic on purpose, and `plan` is optional.
 */
export function billingEligible(
  summary: BillingSummaryResponse | undefined,
): boolean {
  if (!summary || billingStillBlocked(summary)) return false
  const plan = summary.plan
  // A contract always has a price; the legacy Free fallback has none.
  const activeContract =
    plan?.status === "active" &&
    plan.price_usd !== null &&
    plan.price_usd !== undefined
  return summary.trial?.eligible === true || activeContract
}

// The server appends ": <action_url>" to the message. The link becomes a
// button, so the text drops it and ends as a sentence.
export function billingBlockMessage(
  message: string,
  actionUrl: string | undefined,
): string {
  let text = message.trim()
  const url = actionUrl?.trim()
  if (url && text.endsWith(url)) text = text.slice(0, -url.length)
  else text = text.replace(/\s+(?:https?:\/\/|\/)\S*$/, "")
  text = text.replace(/[\s:]+$/, "")
  if (!text) return ""
  return /[.!?]$/.test(text) ? text : `${text}.`
}

/** A billing block from a code alone, such as the summary's trial_block. */
export function billingBlockFromCode(code: BillingBlockCode): BillingBlock {
  const reason = BLOCK_REASONS[code]
  return {
    code,
    reason,
    title: TITLES[reason],
    description: DEFAULT_DESCRIPTIONS[reason],
    href: BILLING_BLOCK_FALLBACK_PATH,
  }
}

/** The billing block a 402 reports, or null for any other error or code. */
export function billingBlockFromError(
  error: unknown,
  origin: string | null = currentOrigin(),
): BillingBlock | null {
  if (!(error instanceof ApiError) || error.status !== 402) return null
  const reason = billingBlockReason(error.code)
  if (!reason) return null
  return {
    code: error.code,
    reason,
    title: TITLES[reason],
    description:
      billingBlockMessage(error.message, error.actionUrl) ||
      DEFAULT_DESCRIPTIONS[reason],
    href: safeBillingActionHref(error.actionUrl, origin),
  }
}
