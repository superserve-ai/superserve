// User-declared routing intent only; never billing or signup eligibility authority.
// `free` and `yc_2026` stay parseable for links and cookies issued before
// signup review; new signups choose among the remaining keys.
export const REQUESTED_OFFER_LABELS = {
  free: "Free",
  starter_monthly: "Starter Monthly",
  starter_annual: "Starter Annual",
  pro_monthly: "Pro Monthly",
  pro_annual: "Pro Annual",
  enterprise: "Enterprise",
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
