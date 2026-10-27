import type { User } from "@supabase/supabase-js"

import {
  SIGNUP_CHECKOUT_OFFERS,
  type SignupCheckoutOffer,
  signupCheckoutRetryPath,
} from "@/lib/billing/signup-checkout-paths"
import { cellFor } from "@/lib/cells"

import { getAuthApiKeyAndTeamForUser } from "./proxy-auth"

const BACKEND_TIMEOUT_MS = 10_000

function successPath(team: string) {
  return `/billing/pro/?${new URLSearchParams({ team, billing: "success" })}`
}

// A team waiting for payment goes straight to its plan's Stripe Checkout.
// Returns null when the team already has a plan, so the caller keeps its
// existing destination; the backend resumes an open checkout on every call.
// switchPlan replaces an open checkout for another plan; resuming never does.
export async function startSignupCheckout(
  user: User,
  offer: SignupCheckoutOffer | undefined,
  origin: string,
  switchPlan = false,
): Promise<string | null> {
  const { apiKey, team } = await getAuthApiKeyAndTeamForUser(user)
  const base = cellFor(team.region).apiBaseUrl
  const headers = { "X-API-Key": apiKey, "Content-Type": "application/json" }
  const plan = await fetch(`${base}/billing/plan`, {
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
  })
  if (!plan.ok) throw new Error(`billing plan read failed: ${plan.status}`)
  const { entry_state: entry } = (await plan.json()) as {
    entry_state?: string
  }
  if (entry !== "pending_payment" && entry !== "payment_failed") return null
  if (!offer) return "/auth/auth-code-error/?reason=plan_required"

  const success = successPath(`${team.region}:${team.teamId}`)
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
          signupCheckoutRetryPath(offer, "checkout_canceled"),
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
    return "/auth/auth-code-error/?reason=plan_unavailable"
  if (!response.ok)
    throw new Error(`signup checkout failed: ${response.status}`)
  if (result.url?.startsWith("https://checkout.stripe.com/")) return result.url
  if (result.outcome === "active") return "/sandboxes"
  return success
}
