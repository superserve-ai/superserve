import { apiClient } from "./client"
import type { PurchaseOffer } from "./signup-plan"

export async function startProCheckout(
  teamKey: string,
  offer: PurchaseOffer,
  returnUrl: string,
): Promise<string | null> {
  const success = new URL(returnUrl)
  success.searchParams.set("billing", "success")
  const cancel = new URL(returnUrl)
  cancel.searchParams.set("billing", "cancel")
  const operationKey = `pro-checkout:${teamKey}:${offer}`
  let operationId = sessionStorage.getItem(operationKey)
  if (!operationId) {
    operationId = crypto.randomUUID()
    sessionStorage.setItem(operationKey, operationId)
  }
  const response = await apiClient<{
    url?: string
    outcome?: string
    error?: { code?: string }
  }>("/stripe/pro-checkout", {
    method: "POST",
    cache: "no-store",
    body: JSON.stringify({
      expected_team: teamKey,
      operation_id: operationId,
      offer,
      success_url: success.toString(),
      cancel_url: cancel.toString(),
    }),
  })
  if (response.outcome === "active")
    clearProOperations([[operationKey, operationId]])
  if (
    response.error?.code === "payment_confirmation_pending" ||
    response.outcome === "payment_confirmation_pending" ||
    response.outcome === "active"
  )
    return null
  if (!response.url || !isStripeCheckoutUrl(response.url))
    throw new Error(
      "Unable to open payment. Check your payment status before trying again.",
    )
  return response.url
}

function proOperations(teamKey: string): [string, string][] {
  const prefix = `pro-checkout:${teamKey}:`
  const operations: [string, string][] = []
  for (let index = 0; index < sessionStorage.length; index++) {
    const key = sessionStorage.key(index)
    if (!key?.startsWith(prefix)) continue
    const value = sessionStorage.getItem(key)
    if (value) operations.push([key, value])
  }
  return operations
}

function clearProOperations(operations: [string, string][]) {
  for (const [key, value] of operations) {
    if (sessionStorage.getItem(key) === value) sessionStorage.removeItem(key)
  }
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
  const operations = proOperations(teamKey)
  const response = await apiClient<{ outcome: string; url?: string }>(
    "/stripe/pro-checkout/recover",
    {
      method: "POST",
      cache: "no-store",
      body: JSON.stringify({ expected_team: teamKey, restart }),
    },
  )
  if (
    response.outcome === "payment_method_required" &&
    response.url &&
    isStripeCheckoutUrl(response.url)
  )
    return response.url
  if (
    ![
      "active",
      "retryable",
      "no_pending_pro_purchase",
      "payment_confirmation_pending",
    ].includes(response.outcome)
  )
    throw new Error("Payment status is unavailable. Please check again.")
  if (
    ["active", "retryable", "no_pending_pro_purchase"].includes(
      response.outcome,
    )
  )
    clearProOperations(operations)
  return response.outcome
}
