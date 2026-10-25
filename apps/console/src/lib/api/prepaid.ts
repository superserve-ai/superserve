import { apiClient } from "./client"
import { isStripeCheckoutUrl } from "./plan-checkout"

export const PREPAID_STEP_CENTS = 500

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
  balance_cents: number
  low_balance: boolean
  auto_recharge: PrepaidAutoRecharge
  has_saved_card: boolean
  purchases: PrepaidPurchase[]
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

export async function startPrepaidCheckout(
  teamKey: string,
  amountCents: number,
  returnUrl: string,
): Promise<string> {
  const success = new URL(returnUrl)
  success.searchParams.set("purchase", "success")
  const cancel = new URL(returnUrl)
  cancel.searchParams.set("purchase", "cancel")
  const response = await apiClient<{ url?: string }>(
    "/billing/prepaid/checkout",
    {
      method: "POST",
      cache: "no-store",
      body: JSON.stringify({
        expected_team: teamKey,
        amount_cents: amountCents,
        success_url: success.toString(),
        cancel_url: cancel.toString(),
      }),
    },
  )
  if (!response.url || !isStripeCheckoutUrl(response.url))
    throw new Error("Unable to open payment. Please try again.")
  return response.url
}

export function setPrepaidAutoRecharge(
  teamKey: string,
  settings: { enabled: boolean; thresholdCents?: number; amountCents?: number },
): Promise<PrepaidCreditSummary> {
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
