import type { User } from "@supabase/supabase-js"

import {
  type AwaitingPlanState,
  isAwaitingPlanState,
  paymentConfirmingPath,
  planPickerPath,
  SIGNUP_CHECKOUT_OFFERS,
  signupCheckoutReturnPath,
  type SignupCheckoutOffer,
} from "@/lib/billing/signup-checkout-paths"
import { cellFor } from "@/lib/cells"

import { getAuthApiKeyAndTeamForUser } from "./proxy-auth"

const BACKEND_TIMEOUT_MS = 10_000

async function teamBackend(user: User) {
  const { apiKey, team } = await getAuthApiKeyAndTeamForUser(user)
  return {
    team,
    base: cellFor(team.region).apiBaseUrl,
    headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
  }
}

async function readEntryState(
  backend: Awaited<ReturnType<typeof teamBackend>>,
): Promise<AwaitingPlanState | null> {
  const plan = await fetch(`${backend.base}/billing/plan`, {
    headers: backend.headers,
    cache: "no-store",
    signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
  })
  if (!plan.ok) throw new Error(`billing plan read failed: ${plan.status}`)
  const { entry_state: entry } = (await plan.json()) as {
    entry_state?: unknown
  }
  return isAwaitingPlanState(entry) ? entry : null
}

// Where a new signup lands: the console while its trial lasts, the plan picker
// once it is used up. Null keeps the caller's destination, so a team that has
// a plan, or a backend without trials, follows today's flow.
export async function signupEntryDestination(
  user: User,
  offer: SignupCheckoutOffer | undefined,
): Promise<string | null> {
  const entry = await readEntryState(await teamBackend(user))
  if (!entry) return null
  if (entry === "trial") return "/sandboxes"
  return planPickerPath(entry, offer)
}

// Starts or resumes the selected plan's Stripe Checkout for a team that has
// not paid yet. Returns null when the team already has a plan. switchPlan
// replaces an open checkout for another plan; resuming never does.
export async function startSignupCheckout(
  user: User,
  offer: SignupCheckoutOffer,
  origin: string,
  switchPlan = false,
): Promise<string | null> {
  const backend = await teamBackend(user)
  if (!(await readEntryState(backend))) return null
  const { base, headers, team } = backend
  const success = signupCheckoutReturnPath(
    user.id,
    `${team.region}:${team.teamId}`,
  )
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
          planPickerPath("checkout_canceled", offer),
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
    return planPickerPath("plan_unavailable")
  if (!response.ok)
    throw new Error(`signup checkout failed: ${response.status}`)
  if (result.url?.startsWith("https://checkout.stripe.com/")) return result.url
  if (result.outcome === "active") return "/sandboxes"
  return success
}

// Settles a checkout the customer just paid, so a team leaving Stripe lands
// in the console with its plan rather than back on the picker.
export async function confirmSignupCheckout(
  user: User,
  account: string | null,
  teamKey: string | null,
): Promise<string> {
  const { base, headers, team } = await teamBackend(user)
  if (account !== user.id || teamKey !== `${team.region}:${team.teamId}`)
    return planPickerPath("checkout_elsewhere")
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
  if (response.ok && result.outcome === "active") return "/sandboxes"
  if (response.ok && result.url?.startsWith("https://checkout.stripe.com/"))
    return result.url
  return paymentConfirmingPath(account, teamKey)
}
