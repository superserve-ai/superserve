// Catalog offer keys a team on its trial may buy, keyed by signup intent.
// Starter links sell Developer once paid-first signup is open.
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

// Entry states that have not paid for a plan yet; any other value, including
// a backend that reports none, keeps today's flow.
export const AWAITING_PLAN_STATES = [
  "trial",
  "trial_ended",
  "payment_failed",
] as const

export type AwaitingPlanState = (typeof AWAITING_PLAN_STATES)[number]

export function isAwaitingPlanState(
  state: unknown,
): state is AwaitingPlanState {
  return (AWAITING_PLAN_STATES as readonly unknown[]).includes(state)
}

// Starts or resumes the team's checkout for offer from inside the console.
export const SIGNUP_CHECKOUT_ROUTE = "/api/onboarding/checkout/"

// Where Stripe returns after payment: it confirms the payment before the
// dashboard, which sends unpaid teams to the picker, is reached.
export const SIGNUP_CHECKOUT_RETURN_ROUTE = "/api/onboarding/checkout/return/"

// The return names the account and team that started checkout, so a session
// that changed in the meantime cannot confirm another team's payment.
export function signupCheckoutReturnPath(account: string, team: string) {
  return `${SIGNUP_CHECKOUT_RETURN_ROUTE}?${new URLSearchParams({ account, team })}`
}

export function signupCheckoutPath(offer: SignupCheckoutOffer) {
  return `${SIGNUP_CHECKOUT_ROUTE}?${new URLSearchParams({ offer })}`
}

export function isSignupCheckoutPath(path: string) {
  const match = /^\/api\/onboarding\/checkout\/\?offer=([a-z_]+)$/.exec(path)
  return !!match && isSignupCheckoutOffer(match[1])
}

export type PlanPickerReason =
  | "upgrade"
  | "payment_confirming"
  | "checkout_elsewhere"
  | "trial_ended"
  | "payment_failed"
  | "plan_unavailable"
  | "checkout_canceled"
  | "checkout_unavailable"

export const PLAN_PICKER_ROUTE = "/auth/choose-plan/"

export function planPickerPath(
  reason: PlanPickerReason,
  offer?: SignupCheckoutOffer,
) {
  const query = new URLSearchParams({ reason })
  if (offer) query.set("offer", offer)
  return `${PLAN_PICKER_ROUTE}?${query}`
}

// The plan a signup asked for, as the picker preselects it.
export function trialPlanOffer(
  requested: string | undefined,
): SignupCheckoutOffer | undefined {
  if (requested === "developer") return "developer"
  if (requested === "pro_monthly" || requested === "pro_annual")
    return "pro_monthly"
  return undefined
}

export function paymentConfirmingPath(account: string, team: string) {
  return `${PLAN_PICKER_ROUTE}?${new URLSearchParams({ reason: "payment_confirming", account, team })}`
}
