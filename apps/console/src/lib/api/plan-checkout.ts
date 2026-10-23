import { ApiError, apiClient } from "./client"
import type { PurchaseOffer } from "./signup-plan"

export const PLAN_UNAVAILABLE_MESSAGE =
  "This plan isn’t available for purchase yet. Choose another plan, or contact us to get started."

export async function startProCheckout(
  teamKey: string,
  offer: PurchaseOffer,
  returnUrl: string,
): Promise<string | null> {
  const success = new URL(returnUrl)
  success.searchParams.set("billing", "success")
  const cancel = new URL(returnUrl)
  cancel.searchParams.set("billing", "cancel")
  const response = await apiClient<{ url?: string; error?: { code?: string } }>(
    "/stripe/pro-checkout",
    {
      method: "POST",
      cache: "no-store",
      body: JSON.stringify({
        expected_team: teamKey,
        offer,
        success_url: success.toString(),
        cancel_url: cancel.toString(),
      }),
    },
  ).catch((error: unknown) => {
    // Billing lists a plan before it can be bought; say so instead of a
    // generic payment failure.
    if (error instanceof ApiError && error.code === "invalid_offer")
      throw new Error(PLAN_UNAVAILABLE_MESSAGE)
    throw error
  })
  if (response.error?.code === "payment_confirmation_pending") return null
  if (!response.url || !isStripeCheckoutUrl(response.url))
    throw new Error(
      "Unable to open payment. Check your payment status before trying again.",
    )
  return response.url
}

export function isStripeCheckoutUrl(value: string) {
  try {
    const url = new URL(value)
    return (
      url.protocol === "https:" &&
      url.hostname === "checkout.stripe.com" &&
      !url.username &&
      !url.password
    )
  } catch {
    return false
  }
}

export async function commitFreePlan(teamKey: string) {
  const response = await apiClient<{ state: string; offer: string }>(
    "/stripe/plan-choice",
    {
      method: "POST",
      cache: "no-store",
      body: JSON.stringify({ expected_team: teamKey, offer: "free" }),
    },
  )
  if (response.state !== "committed" || response.offer !== "free")
    throw new Error("Unable to confirm your plan. Please retry.")
}

export async function recoverProPayment(teamKey: string, restart = false) {
  const response = await apiClient<{ outcome: string }>(
    "/stripe/pro-checkout/recover",
    {
      method: "POST",
      cache: "no-store",
      body: JSON.stringify({ expected_team: teamKey, restart }),
    },
  )
  if (
    ![
      "active",
      "retryable",
      "no_pending_pro_purchase",
      "payment_confirmation_pending",
    ].includes(response.outcome)
  )
    throw new Error("Payment status is unavailable. Please check again.")
  return response.outcome
}
