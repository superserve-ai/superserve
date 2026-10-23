// Pricing v2 signup intent from the website's ?offer=. Routing only; the
// billing backend decides what a team may buy.
export type SignupOffer = "free" | "starter" | "pro_monthly" | "enterprise"

export const SIGNUP_OFFER_PARAM = "signup_offer"

/** Missing or `free` is Free; unknown and retired offers fall back to Pro. */
export function parseSignupOffer(value: unknown): SignupOffer {
  if (typeof value !== "string" || value === "" || value === "free")
    return "free"
  if (value === "enterprise" || value === "pro_monthly") return value
  if (value === "starter" || value.startsWith("starter_")) return "starter"
  return "pro_monthly"
}

// Where a new account lands after signup under pricing v2.
export const SIGNUP_OFFER_DESTINATIONS: Record<SignupOffer, string> = {
  free: "/sandboxes",
  starter: "/billing/starter",
  pro_monthly: "/billing/pro",
  enterprise: "/auth/pending",
}
