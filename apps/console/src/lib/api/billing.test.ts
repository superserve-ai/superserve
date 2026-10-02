import { beforeEach, describe, expect, it, vi } from "vitest"

import type { BillingSummaryResponse } from "./billing"

const apiClient = vi.fn()

vi.mock("./client", () => ({
  apiClient: (...args: unknown[]) => apiClient(...args),
}))

describe("billing api", () => {
  beforeEach(() => {
    apiClient.mockReset()
  })

  it("loads the billing summary from the sandbox billing endpoint", async () => {
    const backendSummary = {
      billing_mode: "live",
      checkout_available: true,
      portal_available: true,
      payment_setup_required: false,
      permissions: {
        can_view: true,
        can_manage: true,
      },
      current_charges_usd: 12,
      credits_applied_usd: 5,
      credits_remaining_usd: 10,
      expected_invoice_amount_usd: 7,
      cost_breakdown_usd: {
        compute: 6,
        memory: 4,
        storage: 2,
      },
      resources: [
        {
          resource_key: "vcpu",
          resource: "cpu",
          display_name: "CPU",
          sort_order: 10,
          unit: "second",
          display_unit: "vCPU-hours",
          usage: 120,
          tracked: true,
          billable: true,
          charge_usd: 6,
        },
        {
          resource_key: "memory_gib",
          resource: "memory",
          display_name: "Memory",
          sort_order: 20,
          unit: "second",
          display_unit: "GiB-hours",
          usage: 2_048_000,
          tracked: true,
          billable: true,
          charge_usd: 4,
        },
        {
          resource_key: "storage_gib",
          resource: "storage",
          display_name: "Storage",
          sort_order: 30,
          unit: "second",
          display_unit: "GiB-hours",
          usage: 4_096_000,
          tracked: true,
          billable: false,
          charge_usd: 2,
        },
      ],
      billing_period: {
        start: "2026-06-01T12:00:00.000Z",
        end: "2026-07-01T12:00:00.000Z",
      },
      pricing_tier: {
        plan_key: "payg",
        plan_name: "Pay-as-you-go",
        currency: "USD",
      },
      calculated_at: "2026-06-30T12:00:00.000Z",
    } satisfies BillingSummaryResponse
    apiClient.mockResolvedValue(backendSummary)

    const { getBillingSummary } = await import("./billing")
    await expect(getBillingSummary()).resolves.toEqual(backendSummary)

    expect(apiClient).toHaveBeenCalledWith("/billing/summary", {
      cache: "no-store",
    })
  })

  it("loads authenticated team pricing without deriving billability from the rate", async () => {
    const pricing = {
      plan_key: "payg",
      plan_name: "Pay as you go",
      currency: "USD",
      rates: [
        {
          resource_key: "storage_gib",
          resource: "storage",
          display_name: "Storage",
          sort_order: 30,
          unit: "second",
          display_unit: "GiB-hours",
          price_usd: 0.00000003,
          price_usd_hourly: 0.000108,
          effective_from: "2026-06-01T00:00:00.000Z",
          tracked: true,
          billable: false,
        },
      ],
    }
    apiClient.mockResolvedValue(pricing)

    const { getBillingPricing } = await import("./billing")
    await expect(getBillingPricing()).resolves.toEqual(pricing)
    expect(apiClient).toHaveBeenCalledWith("/billing/pricing", {
      cache: "no-store",
    })
  })

  it.each([
    ["hourly", "hour"],
    ["daily", "day"],
    ["weekly", "week"],
    ["monthly", "month"],
  ] as const)(
    "maps %s UI granularity to the sandbox %s enum",
    async (granularity, apiGranularity) => {
      apiClient.mockResolvedValue({ buckets: [] })
      const { getBillingUsageSeries } = await import("./billing")

      await getBillingUsageSeries({
        start: "2026-01-01T00:00:00.000Z",
        end: "2026-01-02T00:00:00.000Z",
        granularity,
        timezone: "UTC",
      })

      expect(apiClient).toHaveBeenCalledWith(
        `/billing/usage-series?start=2026-01-01T00%3A00%3A00.000Z&end=2026-01-02T00%3A00%3A00.000Z&granularity=${apiGranularity}&timezone=UTC`,
        { cache: "no-store" },
      )
    },
  )

  it("preserves backend usage-series billability and monetary fields", async () => {
    const response = {
      start: "2026-06-01T00:00:00.000Z",
      end: "2026-06-03T00:00:00.000Z",
      granularity: "day",
      timezone: "UTC",
      buckets: [
        {
          start: "2026-06-01T00:00:00.000Z",
          end: "2026-06-02T00:00:00.000Z",
          cpu: { usage: 1, cost_usd: 1, tracked: true, billable: true },
          memory: { usage: 2, cost_usd: 2, tracked: true, billable: true },
          storage: {
            usage: 100,
            cost_usd: 17.25,
            tracked: true,
            billable: false,
          },
          billed_total_usd: 3,
        },
      ],
    }
    apiClient.mockResolvedValue(response)

    const { getBillingUsageSeries } = await import("./billing")
    await expect(
      getBillingUsageSeries({
        start: response.start,
        end: response.end,
        granularity: "daily",
        timezone: response.timezone,
      }),
    ).resolves.toEqual(response)
  })
})
