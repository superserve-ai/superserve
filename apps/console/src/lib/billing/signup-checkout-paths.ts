// Catalog offer keys a team waiting for payment may buy, keyed by signup
// intent. Starter links sell Developer once paid-first signup is open.
export const SIGNUP_CHECKOUT_OFFERS = {
  developer: "developer_monthly",
  starter: "developer_monthly",
  pro_monthly: "pro_monthly",
} as const

export type SignupCheckoutOffer = keyof typeof SIGNUP_CHECKOUT_OFFERS

export function isSignupCheckoutOffer(
  offer: unknown,
): offer is SignupCheckoutOffer {
  return (
    typeof offer === "string" && Object.hasOwn(SIGNUP_CHECKOUT_OFFERS, offer)
  )
}

// Resumes the team's checkout for offer from inside the console.
export const SIGNUP_CHECKOUT_ROUTE = "/api/onboarding/checkout/"

export function signupCheckoutPath(offer: SignupCheckoutOffer) {
  return `${SIGNUP_CHECKOUT_ROUTE}?${new URLSearchParams({ offer })}`
}

export function signupCheckoutRetryPath(
  offer: SignupCheckoutOffer,
  reason: "checkout_unavailable" | "checkout_canceled" = "checkout_unavailable",
) {
  return `/auth/auth-code-error/?${new URLSearchParams({ reason, offer })}`
}
