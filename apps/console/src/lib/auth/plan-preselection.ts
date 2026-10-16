import { normalizeRequestedOffer, type RequestedOffer } from "./requested-offer"

export const PLAN_OFFER_COOKIE = "ss-plan-offer"

// This is a presentation preference only. The billing backend owns eligibility.
export function readPlanOffer(
  value: string | undefined,
  userId: string,
): RequestedOffer | undefined {
  if (!value) return undefined
  try {
    const intent = JSON.parse(value)
    return intent.userId === userId
      ? normalizeRequestedOffer(intent.offer)
      : undefined
  } catch {
    return undefined
  }
}

export function initialPlanSelection(offer: RequestedOffer | undefined) {
  return {
    selection:
      offer === "free" || offer === "yc_2026"
        ? ("free" as const)
        : ("pro" as const),
    cadence:
      offer === "pro_monthly" ? ("monthly" as const) : ("annual" as const),
  }
}
