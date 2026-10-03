import type {
  BillingPricingResponse,
  BillingSummaryResponse,
  BillingUsageSeriesResponse,
} from "../../../lib/api/billing"

export const scenarios = ["tracked", "zero", "paid", "credited"] as const
export type Scenario = (typeof scenarios)[number]
export const fixtureCookie = "ss669-ui-case"

export function isScenario(
  value: string | undefined | null,
): value is Scenario {
  return scenarios.some((scenario) => scenario === value)
}

export function billingFixture(scenario: Scenario) {
  const billable = scenario !== "tracked"
  const storageCharge =
    scenario === "paid" || scenario === "credited" ? 1.25 : 0
  const charges = 3.6 + storageCharge
  const summary: BillingSummaryResponse = {
    billing_mode: "live",
    checkout_available: false,
    portal_available: false,
    payment_setup_required: false,
    permissions: { can_view: true, can_manage: false },
    current_charges_usd: charges,
    credits_applied_usd: scenario === "credited" ? charges : 0,
    credits_remaining_usd: 0,
    expected_invoice_amount_usd: scenario === "credited" ? 0 : charges,
    cost_breakdown_usd: { compute: 2.4, memory: 1.2, storage: storageCharge },
    resources: [
      {
        resource_key: "vcpu",
        resource: "cpu",
        display_name: "CPU",
        sort_order: 10,
        unit: "second",
        display_unit: "vCPU-hours",
        usage: 120000,
        tracked: true,
        billable: true,
        charge_usd: 2.4,
      },
      {
        resource_key: "memory_gib",
        resource: "memory",
        display_name: "Memory",
        sort_order: 20,
        unit: "second",
        display_unit: "GiB-hours",
        usage: 307200000,
        tracked: true,
        billable: true,
        charge_usd: 1.2,
      },
      {
        resource_key: "storage_gib",
        resource: "storage",
        display_name: "Storage",
        sort_order: 30,
        unit: "second",
        display_unit: "GiB-hours",
        usage: scenario === "zero" ? 0 : 46080000000,
        tracked: true,
        billable,
        charge_usd: storageCharge,
      },
    ],
    billing_period: {
      start: "2026-06-01T00:00:00.000Z",
      end: "2026-06-01T02:00:00.000Z",
    },
    pricing_tier: {
      plan_key: "payg",
      plan_name: "Pay-as-you-go",
      currency: "USD",
    },
    calculated_at: "2026-06-01T02:00:00.000Z",
  }
  const pricing: BillingPricingResponse = {
    ...summary.pricing_tier,
    rates: summary.resources.map((resource, index) => {
      const rate = [0.072, 0.0144, 0.000108][index]
      return {
        resource_key: resource.resource_key,
        resource: resource.resource,
        display_name: resource.display_name,
        sort_order: resource.sort_order,
        unit: "second",
        display_unit: index === 0 ? "vCPU-hour" : "GiB-hour",
        price_usd: rate / 3600,
        price_usd_hourly: rate,
        effective_from: "2026-06-01T00:00:00.000Z",
        tracked: true,
        billable: resource.billable,
      }
    }),
  }
  return { summary, pricing }
}

export function usageFixture(
  scenario: Scenario,
  query: URLSearchParams,
): BillingUsageSeriesResponse {
  const { summary } = billingFixture(scenario)
  const granularity = query.get("granularity")
  if (!["hour", "day", "week", "month"].includes(granularity ?? "")) {
    throw new Error("Unsupported usage granularity")
  }
  const start = query.get("start") ?? summary.billing_period.start
  const end = query.get("end") ?? summary.billing_period.end
  const duration = (new Date(end).getTime() - new Date(start).getTime()) / 2
  return {
    start,
    end,
    granularity: granularity as BillingUsageSeriesResponse["granularity"],
    timezone: query.get("timezone") ?? "UTC",
    buckets: [0, 1].map((index) => {
      // Activated teams retain tracked pre-cutoff usage with zero payable cost.
      const cost = index === 0 ? 0 : summary.cost_breakdown_usd.storage
      const billable = scenario !== "tracked"
      return {
        start: new Date(
          new Date(start).getTime() + index * duration,
        ).toISOString(),
        end: new Date(
          new Date(start).getTime() + (index + 1) * duration,
        ).toISOString(),
        cpu: { usage: 60000, cost_usd: 1.2, tracked: true, billable: true },
        memory: {
          usage: 153600000,
          cost_usd: 0.6,
          tracked: true,
          billable: true,
        },
        storage: {
          usage: scenario === "zero" ? 0 : 23040000000,
          cost_usd: billable ? cost : 0.625,
          tracked: true,
          billable,
        },
        billed_total_usd: 1.8 + cost,
      }
    }),
  }
}
