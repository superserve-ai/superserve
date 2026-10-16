import {
  normalizeRequestedOffer,
  type RequestedOffer,
} from "@/lib/auth/requested-offer"

export type SignupPlanState =
  | "legacy"
  | "selecting"
  | "pending"
  | "committed"
  | "yc_claim"
export type PurchaseOffer = "pro_monthly" | "pro_annual"

export interface SignupPlanContext {
  userId: string
  teamKey: string
  state: SignupPlanState
  offer: "free" | PurchaseOffer | null
  requestedOffer?: RequestedOffer
}

export function parseSignupChoice(
  row: { state?: unknown; offer_key?: unknown } | null,
): Pick<SignupPlanContext, "state" | "offer"> {
  if (!row) return { state: "legacy", offer: null }
  const offer = normalizeRequestedOffer(row.offer_key)
  if (row.state === "selecting" && row.offer_key === null)
    return { state: "selecting", offer: null }
  if (
    (row.state === "pending" || row.state === "committed") &&
    (offer === "free" || offer === "pro_monthly" || offer === "pro_annual")
  )
    return { state: row.state, offer }
  throw new Error("Plan status is unavailable. Please retry.")
}

export function needsPlanSelection(context: Pick<SignupPlanContext, "state">) {
  return context.state === "selecting" || context.state === "pending"
}
