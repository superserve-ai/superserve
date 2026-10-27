// User-declared routing intent only; never billing or signup eligibility authority.
export const REQUESTED_OFFER_LABELS = {
  free: "Free",
  developer: "Developer",
  pro_monthly: "Pro Monthly",
  pro_annual: "Pro Annual",
  yc_2026: "YC",
} as const

export type RequestedOffer = keyof typeof REQUESTED_OFFER_LABELS

export function normalizeRequestedOffer(
  value: unknown,
): RequestedOffer | undefined {
  return typeof value === "string" &&
    Object.hasOwn(REQUESTED_OFFER_LABELS, value)
    ? (value as RequestedOffer)
    : undefined
}

export function normalizeSignupRequestedOffer(
  value: unknown,
): RequestedOffer | undefined {
  if (value === "pro") return "pro_monthly"
  if (value === "starter") return "developer"
  return normalizeRequestedOffer(value)
}
