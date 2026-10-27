import { apiClient } from "./client"
import { isStripeCheckoutUrl } from "./plan-checkout"

export const PREPAID_STEP_CENTS = 500

// Local navigation intent changed; subscribers still read only their actor/team.
export const PREPAID_OPERATIONS_CHANGED =
  "superserve:prepaid-operations-changed"
function notifyPrepaidOperationsChanged() {
  window.dispatchEvent(new Event(PREPAID_OPERATIONS_CHANGED))
}

export interface PrepaidAutoRecharge {
  enabled: boolean
  threshold_cents: number | null
  amount_cents: number | null
  disabled_reason: string | null
  disabled_at: string | null
  in_flight: boolean
}

export interface PrepaidPurchase {
  id: string
  source: "checkout" | "auto_recharge"
  amount_cents: number
  state: "pending" | "paid" | "credited" | "failed"
  failure_reason: string | null
  paid_at: string | null
  credited_at: string | null
  created_at: string
}

export interface PrepaidCreditSummary {
  checkout_idempotency_supported?: boolean
  balance_cents: number
  low_balance: boolean
  auto_recharge: PrepaidAutoRecharge
  has_saved_card: boolean
  purchases: PrepaidPurchase[]
}

export const PREPAID_MAX_CENTS = 1_000_000

export function validNewPrepaidCents(cents: number): boolean {
  return validPrepaidCents(cents) && cents <= PREPAID_MAX_CENTS
}

export function validPrepaidCents(cents: number): boolean {
  return (
    Number.isInteger(cents) &&
    cents >= PREPAID_STEP_CENTS &&
    cents % PREPAID_STEP_CENTS === 0 &&
    cents <= 100_000_000
  )
}

export function getPrepaidCredit(): Promise<PrepaidCreditSummary> {
  return apiClient<PrepaidCreditSummary>("/billing/prepaid", {
    cache: "no-store",
  })
}

export interface PrepaidOperation {
  id: string
  team: string
  actor: string
  amount: number
  success: string
  cancel: string
}

function operationKey(actor: string, team: string, amount: number): string {
  return `starter-checkout:${actor}:${team}:${amount}`
}

export function reconcilePrepaidOperations(
  actor: string,
  team: string,
  purchases: PrepaidPurchase[],
) {
  const terminal = new Set(
    purchases
      .filter((p) => p.state === "credited" || p.state === "failed")
      .map((p) => p.id),
  )
  const prefix = `starter-checkout:${actor}:${team}:`
  let changed = false
  for (let index = sessionStorage.length - 1; index >= 0; index--) {
    const key = sessionStorage.key(index)
    if (!key?.startsWith(prefix)) continue
    const value = sessionStorage.getItem(key)
    if (!value) continue
    try {
      const operation = JSON.parse(value) as PrepaidOperation
      if (
        operation.actor === actor &&
        operation.team === team &&
        terminal.has(operation.id) &&
        sessionStorage.getItem(key) === value
      ) {
        sessionStorage.removeItem(key)
        changed = true
      }
    } catch {
      /* Preserve unreadable recovery state for a deliberate retry. */
    }
  }
  if (changed) notifyPrepaidOperationsChanged()
}

export function retainedPrepaidOperations(
  actor: string,
  team: string,
): PrepaidOperation[] {
  const prefix = `starter-checkout:${actor}:${team}:`
  const operations: PrepaidOperation[] = []
  for (let index = 0; index < sessionStorage.length; index++) {
    const key = sessionStorage.key(index)
    if (!key?.startsWith(prefix)) continue
    try {
      const operation = JSON.parse(
        sessionStorage.getItem(key) ?? "null",
      ) as PrepaidOperation | null
      if (
        operation &&
        operation.actor === actor &&
        operation.team === team &&
        validPrepaidCents(operation.amount) &&
        key === operationKey(actor, team, operation.amount)
      )
        operations.push(operation)
    } catch {
      /* Unreadable state cannot authorize a recovery request. */
    }
  }
  return operations
}

export interface PrepaidCheckoutResult {
  purchase_id: string
  state: "pending" | "paid" | "credited" | "failed"
  url?: string
}

export async function startPrepaidCheckout(
  teamKey: string,
  amountCents: number,
  returnUrl: string,
  actor: string,
  resumeOperationId?: string,
): Promise<PrepaidCheckoutResult> {
  if (!actor || !validPrepaidCents(amountCents))
    throw new Error("Unable to start purchase")
  const key = operationKey(actor, teamKey, amountCents)
  const retained = sessionStorage.getItem(key)
  let operation: PrepaidOperation
  if (retained) {
    operation = JSON.parse(retained) as PrepaidOperation
    if (
      (resumeOperationId !== undefined && operation.id !== resumeOperationId) ||
      operation.team !== teamKey ||
      operation.actor !== actor ||
      operation.amount !== amountCents ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
        operation.id,
      )
    )
      throw new Error(
        "Unable to recover this checkout. Check recent purchases before continuing.",
      )
  } else {
    if (!validNewPrepaidCents(amountCents))
      throw new Error("Enter a multiple of $5 between $5 and $10,000.")
    if (resumeOperationId !== undefined)
      throw new Error(
        "This purchase has already finished or is no longer available for recovery.",
      )
    const id = crypto.randomUUID()
    const success = new URL(returnUrl)
    success.search = ""
    success.searchParams.set("purchase", "success")
    success.searchParams.set("team", teamKey)
    success.searchParams.set("purchase_id", id)
    const cancel = new URL(success)
    cancel.searchParams.set("purchase", "cancel")
    operation = {
      id,
      team: teamKey,
      actor,
      amount: amountCents,
      success: success.toString(),
      cancel: cancel.toString(),
    }
    sessionStorage.setItem(key, JSON.stringify(operation))
    notifyPrepaidOperationsChanged()
  }
  const response = await apiClient<PrepaidCheckoutResult>(
    "/billing/prepaid/checkout",
    {
      method: "POST",
      cache: "no-store",
      body: JSON.stringify({
        expected_team: teamKey,
        operation_id: operation.id,
        amount_cents: amountCents,
        success_url: operation.success,
        cancel_url: operation.cancel,
      }),
    },
  )
  if (
    response.purchase_id !== operation.id ||
    !["pending", "paid", "credited", "failed"].includes(response.state)
  )
    throw new Error(
      "Payment status is uncertain. Retry to check the same purchase.",
    )
  if (response.url && !isStripeCheckoutUrl(response.url))
    throw new Error("Unable to open payment. Retry to check the same purchase.")
  if (response.state === "credited" || response.state === "failed") {
    if (sessionStorage.getItem(key) === JSON.stringify(operation)) {
      sessionStorage.removeItem(key)
      notifyPrepaidOperationsChanged()
    }
  }
  return response
}

export function setPrepaidAutoRecharge(
  teamKey: string,
  settings: { enabled: boolean; thresholdCents?: number; amountCents?: number },
): Promise<PrepaidCreditSummary> {
  if (
    settings.enabled &&
    (!validNewPrepaidCents(settings.thresholdCents ?? NaN) ||
      !validNewPrepaidCents(settings.amountCents ?? NaN))
  )
    throw new Error("Enter a multiple of $5 between $5 and $10,000.")
  return apiClient<PrepaidCreditSummary>("/billing/prepaid/auto-recharge", {
    method: "PUT",
    cache: "no-store",
    body: JSON.stringify({
      expected_team: teamKey,
      enabled: settings.enabled,
      ...(settings.enabled
        ? {
            threshold_cents: settings.thresholdCents,
            amount_cents: settings.amountCents,
          }
        : {}),
    }),
  })
}
