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

// The account and team a picker or checkout request was made for. Requests
// carry it so a session or active team that changed in another tab can never
// start, replace or confirm another team's checkout.
export interface CheckoutLocator {
  account: string
  team: string
}

export function checkoutLocator(
  params: URLSearchParams,
): CheckoutLocator | null {
  const account = params.get("account")
  const team = params.get("team")
  return account && team ? { account, team } : null
}

export function signupCheckoutPath(
  offer: SignupCheckoutOffer,
  locator: CheckoutLocator,
) {
  return `${SIGNUP_CHECKOUT_ROUTE}?${new URLSearchParams({ offer, ...locator })}`
}

// Parses a relative path and accepts it only when it resolves to exactly
// route with no query keys beyond keys, so ".." segments cannot escape it.
function exactRoute(path: string, route: string, keys: readonly string[]) {
  if (!path.startsWith(route)) return null
  const url = new URL(path, "https://console.invalid")
  return url.pathname === route &&
    [...url.searchParams.keys()].every((key) => keys.includes(key))
    ? url
    : null
}

export function isSignupCheckoutPath(path: string) {
  const url = exactRoute(path, SIGNUP_CHECKOUT_ROUTE, [
    "offer",
    "account",
    "team",
  ])
  return !!url && isSignupCheckoutOffer(url.searchParams.get("offer"))
}

export function isSignupCheckoutReturnPath(path: string) {
  return !!exactRoute(path, SIGNUP_CHECKOUT_RETURN_ROUTE, ["account", "team"])
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

// A picker without a locator offers no purchase, only a way back.
export function planPickerPath(
  reason: PlanPickerReason,
  offer?: SignupCheckoutOffer,
  locator?: CheckoutLocator | null,
) {
  const query = new URLSearchParams({ reason })
  if (offer) query.set("offer", offer)
  if (locator) {
    query.set("account", locator.account)
    query.set("team", locator.team)
  }
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

// Where a team that has not paid must go before using the console: the picker
// once its trial is used up, or the payment check while a paid checkout settles.
export function awaitingPlanRedirect(context: {
  userId: string
  teamKey: string
  entryState?: AwaitingPlanState
  paymentSettling?: boolean
  requestedOffer?: string
}): string | null {
  const entry = context.entryState
  if (entry !== "trial_ended" && entry !== "payment_failed") return null
  const locator = { account: context.userId, team: context.teamKey }
  return context.paymentSettling
    ? planPickerPath("payment_confirming", undefined, locator)
    : planPickerPath(entry, trialPlanOffer(context.requestedOffer), locator)
}

export function isPlanPickerPath(path: string) {
  return !!exactRoute(path, PLAN_PICKER_ROUTE, [
    "reason",
    "offer",
    "account",
    "team",
  ])
}
