import { apiClient } from "./client"

export interface BillingSummaryCostBreakdown {
  compute: number
  memory: number
  storage: number
}

export interface BillingSummaryPermissions {
  can_view: boolean
  can_manage: boolean
}

export interface BillingSummaryResource {
  resource_key: string
  resource: string
  display_name: string
  sort_order: number
  unit: string
  display_unit: string
  usage: number
  tracked: boolean
  billable: boolean
  charge_usd: number
}

export interface BillingSummaryPeriod {
  start: string
  end: string
}

export interface BillingSummaryPricingTier {
  plan_key: string
  plan_name: string
  currency: string
}

export interface BillingTrialBalance {
  grant_usd?: number | null
  consumed_usd?: number | null
  remaining_usd?: number | null
  state: string
  eligible?: boolean
  // Optional during the SS-484 rollout; the server downgrades stale runway to unknown.
  runway_state?: "over_24h" | "under_24h" | "unknown" | null
  runway_observed_at?: string | null
}

export interface BillingSummaryResponse {
  trial?: BillingTrialBalance | null
  billing_mode: "shadow" | "live"
  checkout_available: boolean
  portal_available: boolean
  payment_setup_required: boolean
  permissions: BillingSummaryPermissions
  current_charges_usd: number
  credits_applied_usd: number
  credits_remaining_usd: number
  expected_invoice_amount_usd: number
  cost_breakdown_usd: BillingSummaryCostBreakdown
  resources: BillingSummaryResource[]
  resources_by_key?: Record<string, BillingSummaryResource>
  billing_period: BillingSummaryPeriod
  pricing_tier: BillingSummaryPricingTier
  calculated_at: string
}

export async function getBillingSummary(): Promise<BillingSummaryResponse> {
  return apiClient<BillingSummaryResponse>("/billing/summary", {
    cache: "no-store",
  })
}

export type BillingUsageGranularity = "hourly" | "daily" | "weekly" | "monthly"
/** Values accepted by the usage-series endpoint. */
export type BillingUsageApiGranularity = "hour" | "day" | "week" | "month"
const BILLING_USAGE_API_GRANULARITY = {
  hourly: "hour",
  daily: "day",
  weekly: "week",
  monthly: "month",
} as const satisfies Record<BillingUsageGranularity, BillingUsageApiGranularity>
/** Serialize the UI aggregation value to the enum accepted by the sandbox API. */
export function toBillingUsageApiGranularity(
  granularity: BillingUsageGranularity,
): BillingUsageApiGranularity {
  return BILLING_USAGE_API_GRANULARITY[granularity]
}
export interface BillingUsageSeriesResource {
  usage: number
  cost_usd: number
  tracked: boolean
  billable: boolean
}
export interface BillingUsageSeriesBucket {
  start: string
  end: string
  cpu: BillingUsageSeriesResource
  memory: BillingUsageSeriesResource
  storage: BillingUsageSeriesResource
  billed_total_usd: number
}
export interface BillingUsageSeriesResponse {
  start: string
  end: string
  granularity: BillingUsageApiGranularity
  timezone: string
  buckets: BillingUsageSeriesBucket[]
}
export async function getBillingUsageSeries(params: {
  start: string
  end: string
  granularity: BillingUsageGranularity
  timezone: string
}) {
  const query = new URLSearchParams({
    start: params.start,
    end: params.end,
    granularity: toBillingUsageApiGranularity(params.granularity),
    timezone: params.timezone,
  })
  return apiClient<BillingUsageSeriesResponse>(
    `/billing/usage-series?${query}`,
    { cache: "no-store" },
  )
}
