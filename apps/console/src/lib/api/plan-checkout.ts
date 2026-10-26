import { apiClient } from "./client"
import type { PurchaseOffer } from "./signup-plan"

export async function startProCheckout(
  teamKey: string,
  offer: PurchaseOffer,
  returnUrl: string,
  actor?: string,
): Promise<string | null> {
  const success = new URL(returnUrl)
  success.searchParams.set("billing", "success")
  const cancel = new URL(returnUrl)
  cancel.searchParams.set("billing", "cancel")
  const operationKey = proOperationKey(teamKey, offer, actor)
  let operationId = sessionStorage.getItem(operationKey)
  if (!operationId) {
    operationId = crypto.randomUUID()
    sessionStorage.setItem(operationKey, operationId)
  }
  const contextKey = `${operationKey}:context`
  const retained = sessionStorage.getItem(contextKey)
  let context: ProCheckoutContext
  if (retained) {
    context = JSON.parse(retained) as ProCheckoutContext
    if (
      context.id !== operationId ||
      context.team !== teamKey ||
      context.offer !== offer ||
      context.actor !== actor
    )
      throw new Error(
        "The saved checkout belongs to another account or operation. Check payment status for the original team.",
      )
  } else {
    context = {
      id: operationId,
      team: teamKey,
      offer,
      actor,
      success: success.toString(),
      cancel: cancel.toString(),
    }
    sessionStorage.setItem(contextKey, JSON.stringify(context))
  }
  const response = await dispatchProCheckout(context)
  if (response.outcome === "active")
    clearProOperations([
      [operationKey, operationId],
      [contextKey, JSON.stringify(context)],
    ])
  return proCheckoutDestination(response)
}

interface ProCheckoutContext {
  id: string
  actor?: string
  team: string
  offer: PurchaseOffer
  success: string
  cancel: string
}
interface ProCheckoutResponse {
  url?: string
  outcome?: string
  error?: { code?: string }
}

async function dispatchProCheckout(
  context: ProCheckoutContext,
): Promise<ProCheckoutResponse> {
  return apiClient<ProCheckoutResponse>("/stripe/pro-checkout", {
    method: "POST",
    cache: "no-store",
    body: JSON.stringify({
      expected_team: context.team,
      operation_id: context.id,
      offer: context.offer,
      success_url: context.success,
      cancel_url: context.cancel,
    }),
  })
}

function proCheckoutDestination(response: ProCheckoutResponse): string | null {
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

export async function resumeProCheckout(
  team: string,
  actor: string,
): Promise<string | null> {
  const contexts: ProCheckoutContext[] = []
  for (const offer of ["pro_monthly", "pro_annual"] as const) {
    const key = proOperationKey(team, offer, actor)
    const raw = sessionStorage.getItem(`${key}:context`)
    if (!raw) continue
    const context = JSON.parse(raw) as ProCheckoutContext
    if (
      context.actor === actor &&
      context.team === team &&
      context.offer === offer &&
      context.id === sessionStorage.getItem(key)
    )
      contexts.push(context)
  }
  if (contexts.length !== 1) return null
  const context = contexts[0]!
  const response = await dispatchProCheckout(context)
  // This operation is an existing replay only; never create or rotate an ID.
  return proCheckoutDestination(response)
}

function proOperationKey(team: string, offer: PurchaseOffer, actor?: string) {
  const legacyKey = `pro-checkout:${team}:${offer}`
  if (!actor) return legacyKey
  const key = `${legacyKey}:actor:${encodeURIComponent(actor)}`
  if (sessionStorage.getItem(key) || sessionStorage.getItem(`${key}:context`))
    return key

  // Keep accepted operations from before actor-scoped keys recoverable in place.
  const legacyId = sessionStorage.getItem(legacyKey)
  const raw = sessionStorage.getItem(`${legacyKey}:context`)
  if (!legacyId && !raw) return key
  const context = raw ? (JSON.parse(raw) as ProCheckoutContext) : null
  if (context?.actor && context.actor !== actor) return key
  if (
    !context ||
    context.actor !== actor ||
    context.team !== team ||
    context.offer !== offer ||
    context.id !== legacyId
  )
    throw new Error(
      "The saved checkout cannot be identified. Check payment status before trying again.",
    )
  return legacyKey
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
