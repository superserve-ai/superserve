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
export type PurchaseOffer =
  | "starter_monthly"
  | "starter_annual"
  | "pro_monthly"
  | "pro_annual"
export type PlanFamily = "starter" | "pro"
export type PlanCadence = "monthly" | "annual"

export const PURCHASE_OFFERS: readonly PurchaseOffer[] = [
  "starter_monthly",
  "starter_annual",
  "pro_monthly",
  "pro_annual",
]

export function isPurchaseOffer(value: unknown): value is PurchaseOffer {
  return PURCHASE_OFFERS.includes(value as PurchaseOffer)
}

export function purchaseOffer(
  family: PlanFamily,
  cadence: PlanCadence,
): PurchaseOffer {
  return `${family}_${cadence}`
}

export function offerCadence(offer: string | null | undefined) {
  return isPurchaseOffer(offer)
    ? (offer.slice(offer.indexOf("_") + 1) as PlanCadence)
    : undefined
}

export interface SignupPlanContext {
  userId: string
  teamKey: string
  state: SignupPlanState
  offer: "free" | PurchaseOffer | null
  requestedOffer?: RequestedOffer
  // Set for accounts that chose their plan during reviewed signup.
  reviewed?: boolean
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
    (offer === "free" || isPurchaseOffer(offer))
  )
    return { state: row.state, offer }
  throw new Error("Plan status is unavailable. Please retry.")
}

export function needsPlanSelection(context: Pick<SignupPlanContext, "state">) {
  return context.state === "selecting" || context.state === "pending"
}
