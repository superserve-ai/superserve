import type { User } from "@supabase/supabase-js"

import { cellFor } from "@/lib/cells"

import { getAuthApiKeyAndTeamForUser } from "./proxy-auth"

// Catalog offer keys a new team may buy at signup, keyed by signup intent.
const SIGNUP_CHECKOUT_OFFERS = {
  developer: "developer_monthly",
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

export function signupCheckoutReturnPath(
  team: string,
  outcome: "success" | "cancel",
) {
  return `/billing/pro/?${new URLSearchParams({ team, billing: outcome })}`
}

// A new team waiting for payment goes straight to its plan's Stripe Checkout.
// Returns null when the team already has a plan, so the caller keeps its
// existing destination; the backend resumes an open checkout on every call.
export async function startSignupCheckout(
  user: User,
  offer: SignupCheckoutOffer | undefined,
  origin: string,
): Promise<string | null> {
  const { apiKey, team } = await getAuthApiKeyAndTeamForUser(user)
  const base = cellFor(team.region).apiBaseUrl
  const headers = { "X-API-Key": apiKey, "Content-Type": "application/json" }
  const plan = await fetch(`${base}/billing/plan`, {
    headers,
    cache: "no-store",
  })
  if (!plan.ok) throw new Error(`billing plan read failed: ${plan.status}`)
  const { entry_state: entry } = (await plan.json()) as {
    entry_state?: string
  }
  if (entry !== "pending_payment" && entry !== "payment_failed") return null
  if (!offer) return "/auth/auth-code-error/?reason=plan_required"

  const teamKey = `${team.region}:${team.teamId}`
  const success = signupCheckoutReturnPath(teamKey, "success")
  const response = await fetch(`${base}/stripe/checkout-session`, {
    method: "POST",
    headers,
    cache: "no-store",
    body: JSON.stringify({
      offer: SIGNUP_CHECKOUT_OFFERS[offer],
      success_url: new URL(success, origin).toString(),
      cancel_url: new URL(
        signupCheckoutReturnPath(teamKey, "cancel"),
        origin,
      ).toString(),
    }),
  })
  const result = (await response.json().catch(() => ({}))) as {
    url?: string
    outcome?: string
    error?: { code?: string }
  }
  if (response.status === 400 && result.error?.code === "invalid_offer")
    return "/auth/auth-code-error/?reason=plan_unavailable"
  if (!response.ok)
    throw new Error(`signup checkout failed: ${response.status}`)
  if (result.url?.startsWith("https://checkout.stripe.com/")) return result.url
  if (result.outcome === "active") return "/sandboxes"
  return success
}
