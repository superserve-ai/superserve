import type { User } from "@supabase/supabase-js"

import {
  type AwaitingPlanState,
  isAwaitingPlanState,
  type CheckoutLocator,
  isPaymentActivating,
  paymentSettlingPath,
  signupCheckoutReturnPath,
  planPickerPath,
  SIGNUP_CHECKOUT_OFFERS,
  type SignupCheckoutOffer,
} from "@/lib/billing/signup-checkout-paths"
import { cellFor } from "@/lib/cells"

import { isStripeCheckoutUrl } from "./plan-checkout"
import { getAuthApiKeyAndTeamForUser } from "./proxy-auth"

const BACKEND_TIMEOUT_MS = 10_000

async function teamBackend(user: User) {
  const { apiKey, team } = await getAuthApiKeyAndTeamForUser(user)
  return {
    team,
    locator: { account: user.id, team: `${team.region}:${team.teamId}` },
    base: cellFor(team.region).apiBaseUrl,
    headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
  }
}

async function readEntryState(
  backend: Awaited<ReturnType<typeof teamBackend>>,
): Promise<AwaitingPlanState | "activating" | null> {
  const plan = await fetch(`${backend.base}/billing/plan`, {
    headers: backend.headers,
    cache: "no-store",
    signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
  })
  if (!plan.ok) throw new Error(`billing plan read failed: ${plan.status}`)
  const body = (await plan.json()) as { entry_state?: unknown }
  if (isPaymentActivating(body)) return "activating"
  return isAwaitingPlanState(body.entry_state) ? body.entry_state : null
}

// Where a new signup lands: the console while its trial lasts, the plan picker
// once it is used up. Null keeps the caller's destination, so a team that has
// a plan, or a backend without trials, follows today's flow.
export async function signupEntryDestination(
  user: User,
  offer: SignupCheckoutOffer | undefined,
): Promise<string | null> {
  const backend = await teamBackend(user)
  const entry = await readEntryState(backend)
  if (!entry) return null
  if (entry === "trial") return "/sandboxes"
  if (entry === "activating") return paymentSettlingPath(backend.locator)
  return planPickerPath(entry, offer, backend.locator)
}

// Starts or resumes the selected plan's Stripe Checkout for a team that has
// not paid yet. Another account's request is refused before the team lookup,
// which can provision a first team. Returns null when the team already has a plan. switchPlan
// replaces an open checkout for another plan; resuming never does.
export async function startSignupCheckout(
  user: User,
  offer: SignupCheckoutOffer,
  origin: string,
  expected: CheckoutLocator,
  switchPlan = false,
): Promise<string | null> {
  if (expected.account !== user.id) return planPickerPath("checkout_elsewhere")
  const backend = await teamBackend(user)
  const { base, headers, locator } = backend
  if (expected.team !== locator.team)
    return planPickerPath("checkout_elsewhere")
  const entry = await readEntryState(backend)
  if (!entry || entry === "activating") return null
  const success = signupCheckoutReturnPath(locator.account, locator.team)
  const create = async () => {
    const response = await fetch(`${base}/stripe/checkout-session`, {
      method: "POST",
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
      body: JSON.stringify({
        offer: SIGNUP_CHECKOUT_OFFERS[offer],
        success_url: new URL(success, origin).toString(),
        cancel_url: new URL(
          planPickerPath("checkout_canceled", offer, locator),
          origin,
        ).toString(),
      }),
    })
    const result = (await response.json().catch(() => ({}))) as {
      url?: string
      outcome?: string
      error?: { code?: string }
    }
    return { response, result }
  }
  let { response, result } = await create()
  if (
    switchPlan &&
    response.status === 409 &&
    result.error?.code === "plan_conflict"
  ) {
    const restart = await fetch(`${base}/stripe/pro-checkout/recover`, {
      method: "POST",
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
      body: JSON.stringify({ restart: true }),
    })
    if (restart.ok) ({ response, result } = await create())
  }
  if (response.status === 400 && result.error?.code === "invalid_offer")
    return planPickerPath("plan_unavailable", undefined, locator)
  if (!response.ok)
    throw new Error(`signup checkout failed: ${response.status}`)
  if (result.url && isStripeCheckoutUrl(result.url)) return result.url
  if (result.outcome === "active") return "/sandboxes"
  return success
}

// Settles a checkout the customer just paid. Returns where to go next, or
// null while the payment is still settling: a team that came back from a paid
// checkout waits for its plan rather than being sent back to the picker.
export async function settleSignupCheckout(
  user: User,
  account: string | null,
  teamKey: string | null,
): Promise<string | null> {
  if (!account || !teamKey) return planPickerPath("checkout_elsewhere")
  const original = { account, team: teamKey }
  if (account !== user.id)
    return planPickerPath("checkout_elsewhere", undefined, original)
  const backend = await teamBackend(user)
  const { base, headers, locator } = backend
  if (teamKey !== locator.team)
    return planPickerPath("checkout_elsewhere", undefined, original)
  const response = await fetch(`${base}/stripe/pro-checkout/recover`, {
    method: "POST",
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
    body: JSON.stringify({ restart: false }),
  })
  const result = (await response.json().catch(() => ({}))) as {
    outcome?: string
    url?: string
  }
  if (response.status >= 500) return null
  if (response.ok && result.url && isStripeCheckoutUrl(result.url))
    return result.url
  const active = response.ok && result.outcome === "active"
  if (
    response.ok &&
    !active &&
    !["retryable", "no_pending_pro_purchase"].includes(result.outcome ?? "")
  )
    return null
  const entry = await readEntryState(backend)
  if (entry === "activating" || (active && entry === "trial_ended")) return null
  if (entry === "trial_ended" || entry === "payment_failed")
    return planPickerPath(entry, undefined, locator)
  return "/sandboxes"
}
