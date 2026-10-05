import { ApiError, apiClient } from "./client"

export interface CustomerBillingUsageResponse {
  period_id: string
  team_id: string
  status: string
  period_start: string
  period_end: string
  vcpu_seconds: number
  memory_mib_seconds: number
  storage_mib_seconds: number
  cpu_vcpu_hours: number
  memory_gib_hours: number
  storage_gib_hours: number
  exported_at?: string
  finalized_at?: string
  updated_at: string
}

export interface CustomerBillingPeriodResponse {
  period_id: string
  period_start: string
  period_end: string
  status: string
  blocked_reason?: string
  approved_at?: string
  exported_at?: string
  finalized_at?: string
  cancel_at_period_end?: boolean
  stripe_customer_id?: string
  stripe_subscription_id?: string
  stripe_subscription_status?: string
  stripe_invoice_status?: string
  current_period_start?: string
  current_period_end?: string
}

export interface CustomerBillingPeriodsResponse {
  periods: CustomerBillingPeriodResponse[]
}

export type CustomerBillingExportMode = "shadow" | "live"

export interface CustomerBillingExportPreviewItem {
  resource_type: string
  stripe_event_name: string
  stripe_meter_event_identifier: string
  value: number
}

export interface CustomerBillingExportPreviewAttempt {
  id: string
  resource_type: string
  stripe_meter_event_identifier: string
  stripe_event_name: string
  value: number
  status: string
  error?: string
  sent_at?: string
  created_at: string
}

export interface CustomerBillingExportPreviewResponse {
  mode: CustomerBillingExportMode
  period_id: string
  team_id: string
  status: string
  stripe_customer_id?: string
  items: CustomerBillingExportPreviewItem[]
  attempts: CustomerBillingExportPreviewAttempt[]
}

export interface BillingSessionResponse {
  id?: string
  url: string
}

function teamBillingPath(teamId: string, suffix: string): string {
  return `/teams/${encodeURIComponent(teamId)}${suffix}`
}

export async function getCustomerBillingUsage(
  teamId: string,
  periodStart: string,
  periodEnd: string,
): Promise<CustomerBillingUsageResponse> {
  const query = new URLSearchParams({
    period_start: periodStart,
    period_end: periodEnd,
  })

  return apiClient<CustomerBillingUsageResponse>(
    `${teamBillingPath(teamId, "/billing/usage")}?${query.toString()}`,
    {
      cache: "no-store",
    },
  )
}

export async function listCustomerBillingPeriods(
  teamId: string,
  limit = 8,
): Promise<CustomerBillingPeriodsResponse> {
  const query = new URLSearchParams({
    limit: String(limit),
  })

  return apiClient<CustomerBillingPeriodsResponse>(
    `${teamBillingPath(teamId, "/billing/periods")}?${query.toString()}`,
    {
      cache: "no-store",
    },
  )
}

export async function getCustomerBillingExportPreview(
  teamId: string,
  periodId: string,
): Promise<CustomerBillingExportPreviewResponse> {
  return apiClient<CustomerBillingExportPreviewResponse>(
    `${teamBillingPath(
      teamId,
      `/billing/periods/${encodeURIComponent(periodId)}/export-preview`,
    )}`,
    {
      cache: "no-store",
    },
  )
}

export async function createStripeCheckoutSession(params: {
  successUrl: string
  cancelUrl: string
  intentScope: string
}): Promise<BillingSessionResponse> {
  const key = `superserve:checkout:${params.intentScope}`
  const raw = sessionStorage.getItem(key)
  let intent: {
    operationId: string
    receipt?: string
    newOnNextClick?: boolean
  } = raw ? JSON.parse(raw) : { operationId: crypto.randomUUID() }
  if (intent.newOnNextClick) {
    // The preceding conflict asked for an explicit new attempt. Keep the old
    // receipt available; a conflict alone does not prove it was retired.
    sessionStorage.setItem(
      `${key}:previous:${intent.operationId}`,
      JSON.stringify(intent),
    )
    intent = { operationId: crypto.randomUUID() }
  }
  // Retain before either request. Failure to retain stops dispatch.
  sessionStorage.setItem(key, JSON.stringify(intent))
  if (!intent.receipt) {
    const prepared = await apiClient<
      { receipt: string } | BillingSessionResponse
    >("/stripe/checkout-session", {
      method: "POST",
      cache: "no-store",
      body: JSON.stringify({
        prepare: true,
        operation_id: intent.operationId,
        success_url: params.successUrl,
        cancel_url: params.cancelUrl,
      }),
    })
    if ("url" in prepared) return prepared
    intent.receipt = prepared.receipt
    sessionStorage.setItem(key, JSON.stringify(intent))
  }
  // Keep the receipt after success for lost navigation/refresh recovery.
  try {
    return await apiClient<BillingSessionResponse>("/stripe/checkout-session", {
      method: "POST",
      cache: "no-store",
      body: JSON.stringify({ receipt: intent.receipt }),
    })
  } catch (error) {
    if (
      error instanceof ApiError &&
      error.status === 409 &&
      error.code === "conflict"
    ) {
      intent.newOnNextClick = true
      sessionStorage.setItem(key, JSON.stringify(intent))
      throw new Error(
        "Checkout could not resume. Click Set Up Billing again to request a new attempt; any existing Checkout must finish or expire first.",
        { cause: error },
      )
    }
    throw error
  }
}

export async function createStripeCustomerPortalSession(params: {
  returnUrl: string
}): Promise<BillingSessionResponse> {
  return apiClient<BillingSessionResponse>("/stripe/customer-portal-session", {
    method: "POST",
    cache: "no-store",
    body: JSON.stringify({
      return_url: params.returnUrl,
    }),
  })
}
