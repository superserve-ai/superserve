import type { RequestedOffer } from "@/lib/auth/requested-offer"
import {
  PAYMENT_ACTIVATING,
  type AwaitingPlanState,
} from "@/lib/billing/signup-checkout-paths"

export type SignupPlanState =
  | "legacy"
  | "selecting"
  | "pending"
  | "committed"
  | "yc_claim"
export type PurchaseOffer = "pro_monthly" | "pro_annual"

// A paid offer is any catalog offer key, <family>_monthly or <family>_annual,
// so a plan the catalog adds is recognised without a console change.
export type PaidOffer = string

export function isPaidCatalogOffer(value: unknown): value is PaidOffer {
  return (
    typeof value === "string" &&
    /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*_(?:monthly|annual)$/.test(value)
  )
}

export interface SignupPlanContext {
  userId: string
  teamKey: string
  state: SignupPlanState
  offer: "free" | PaidOffer | null
  requestedOffer?: RequestedOffer
  entryState?: AwaitingPlanState
  paymentSettling?: boolean
  // The team already has a pricing v2 plan and skips the legacy picker.
  planAssigned?: boolean
}

export function parseSignupChoice(
  row: { state?: unknown; offer_key?: unknown } | null,
): Pick<SignupPlanContext, "state" | "offer"> {
  if (!row) return { state: "legacy", offer: null }
  if (row.state === "selecting" && row.offer_key === null)
    return { state: "selecting", offer: null }
  const offer = row.offer_key
  if (
    (row.state === "pending" || row.state === "committed") &&
    (offer === "free" || isPaidCatalogOffer(offer))
  )
    return { state: row.state, offer }
  throw new Error("Plan status is unavailable. Please retry.")
}

// A team the legacy picker skips never chose a plan, so it records why it
// skipped instead of a Free completion.
export function skippedPlanEvent(
  context: SignupPlanContext,
  billingReturn?: string,
) {
  return {
    action: "skipped",
    requested_offer: context.requestedOffer ?? "not_specified",
    entry_state:
      context.entryState ??
      (context.paymentSettling
        ? PAYMENT_ACTIVATING
        : context.planAssigned
          ? "plan_assigned"
          : "legacy"),
    ...(billingReturn ? { billing_return: billingReturn } : {}),
  }
}

export function needsPlanSelection(context: Pick<SignupPlanContext, "state">) {
  return context.state === "selecting" || context.state === "pending"
}
