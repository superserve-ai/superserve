// Pricing v2 signup intent from the website's ?offer=. Routing only; the
// billing backend decides what a team may buy.
export type SignupOffer =
  | "free"
  | "starter"
  | "developer"
  | "pro_monthly"
  | "enterprise"

export const SIGNUP_OFFER_PARAM = "signup_offer"

/** Missing or `free` is Free; unknown and retired offers fall back to Pro. */
export function parseSignupOffer(value: unknown): SignupOffer {
  if (typeof value !== "string" || value === "" || value === "free")
    return "free"
  // Website aliases select the monthly-only v2 launch offer. Existing annual
  // contracts and accepted checkouts retain their backend-authorized cadence.
  if (value === "pro" || value === "pro_annual") return "pro_monthly"
  if (value === "enterprise" || value === "pro_monthly") return value
  if (value === "developer") return "developer"
  if (value === "starter" || value.startsWith("starter_")) return "starter"
  return "pro_monthly"
}

// Where a new account lands after signup under pricing v2. A new team waiting
// for payment goes to its plan's Stripe Checkout instead; Developer is sold
// only that way.
export const SIGNUP_OFFER_DESTINATIONS: Record<SignupOffer, string> = {
  free: "/sandboxes",
  starter: "/plan-usage/buy-credit",
  developer: "/sandboxes",
  pro_monthly: "/billing/pro/",
  enterprise: "/auth/pending",
}

export function isSelfServeSignupOffer(raw: unknown): raw is string {
  return (
    typeof raw === "string" &&
    ([
      "free",
      "developer",
      "starter",
      "pro",
      "pro_monthly",
      "pro_annual",
    ].includes(raw) ||
      raw.startsWith("starter_"))
  )
}

// Navigation intent never assigns a plan or grants payment authority. Existing
// accounts must not enter the new-account Enterprise hold through a sign-in URL.
export function signInOfferDestination(raw: unknown): string {
  const offer = parseSignupOffer(raw)
  return offer === "enterprise"
    ? "/sandboxes"
    : SIGNUP_OFFER_DESTINATIONS[offer]
}
