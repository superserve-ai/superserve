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
  // A team after the account's first, which never gets Free or a trial.
  "plan_required",
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
  | "checkout_elsewhere"
  | "trial_ended"
  | "payment_failed"
  | "plan_required"
  | "plan_unavailable"
  | "checkout_canceled"
  | "checkout_unavailable"
  | "checkout_refused"
  | "billing_admin_required"

// Why a team that is awaiting its first plan has no trial. The states never
// share a message:
// - "ended": the trial grant was spent or expired.
// - "unavailable": the team never got a trial. Either the server reported the
//   trial as denied, or it read the trial reason, found none, and holds the
//   team at trial_ended with no trial grant, which is how it reports a denial
//   it keeps generic. Why a team was denied is never shown.
// - "check_unavailable": the trial could not be confirmed because a required
//   check did not complete. Not a denial and not proof of anything.
// - "unknown": no reason is known, so the copy claims nothing about the trial.
export type TrialOutcome =
  | "ended"
  | "unavailable"
  | "check_unavailable"
  | "unknown"

export function trialOutcome(summary: unknown): TrialOutcome {
  const {
    trial,
    trial_block: block,
    trial_block_read: blockRead,
    plan,
  }: {
    trial?: { state?: unknown } | null
    trial_block?: unknown
    trial_block_read?: unknown
    plan?: { key?: unknown; status?: unknown } | null
  } = summary && typeof summary === "object" ? summary : {}
  // The server's own reason wins over the balance, which can be stale or read
  // separately: check_unavailable, then exhausted, then unavailable (denied).
  if (block === "trial_check_unavailable") return "check_unavailable"
  if (block === "trial_exhausted") return "ended"
  if (block === "trial_unavailable") return "unavailable"
  if (trial?.state === "exhausted" || trial?.state === "expired") return "ended"
  // A null trial_block also means the server could not read the reason, so
  // only a reason it read and found empty says a team held at trial_ended
  // with no grant never had a trial. A server that does not send
  // trial_block_read stays unknown.
  if (
    blockRead === true &&
    trial?.state === "no_grant" &&
    plan?.key === "trial" &&
    plan.status === "trial_ended"
  ) {
    return "unavailable"
  }
  return "unknown"
}

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

// A paid checkout whose plan is not active yet waits here, never on the picker.
export const PAYMENT_SETTLING_ROUTE = "/onboarding/payment/"

export function paymentSettlingPath(locator: CheckoutLocator) {
  return `${PAYMENT_SETTLING_ROUTE}?${new URLSearchParams({ ...locator })}`
}

// The backend's explicit "paid, plan activating" state, read from the plan
// response when it reports one. Its absence says nothing either way.
export const PAYMENT_ACTIVATING = "activating"

export function isPaymentActivating(plan: unknown): boolean {
  if (!plan || typeof plan !== "object") return false
  const { entry_state, pro_checkout } = plan as {
    entry_state?: unknown
    pro_checkout?: { status?: unknown } | null
  }
  return (
    entry_state === PAYMENT_ACTIVATING ||
    pro_checkout?.status === PAYMENT_ACTIVATING
  )
}

// Where a team that has not paid must go before using the console: the picker
// once its trial is used up, or the payment wait while a paid checkout settles.
export function awaitingPlanRedirect(context: {
  userId: string
  teamKey: string
  entryState?: AwaitingPlanState
  paymentSettling?: boolean
  requestedOffer?: string
}): string | null {
  const entry = context.entryState
  const locator = { account: context.userId, team: context.teamKey }
  if (
    context.paymentSettling &&
    (entry === "trial_ended" ||
      entry === "plan_required" ||
      entry === undefined)
  )
    return paymentSettlingPath(locator)
  if (
    entry !== "trial_ended" &&
    entry !== "payment_failed" &&
    entry !== "plan_required"
  )
    return null
  return planPickerPath(entry, trialPlanOffer(context.requestedOffer), locator)
}

export function isPlanPickerPath(path: string) {
  return !!exactRoute(path, PLAN_PICKER_ROUTE, [
    "reason",
    "offer",
    "account",
    "team",
  ])
}
