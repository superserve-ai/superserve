import { describe, expect, it } from "vitest"

import type { BillingPricingResponse } from "@/lib/api/billing"

import { allowanceEquivalentMinutes } from "./plan-overview"

function pricing(cpu: number, memory: number): BillingPricingResponse {
  return {
    currency: "USD",
    plan_key: "free",
    rates: [
      {
        resource_key: "vcpu",
        display_unit: "vCPU-hour",
        price_usd_hourly: cpu,
      },
      {
        resource_key: "memory_gib",
        display_unit: "GiB-hour",
        price_usd_hourly: memory,
      },
    ],
  } as BillingPricingResponse
}
describe("compute allowance equivalent", () => {
  it("derives time from backend money and team rates, excluding storage", () => {
    expect(allowanceEquivalentMinutes(13.32, pricing(0.06, 0.0066))).toBe(
      "2 hours",
    )
    expect(allowanceEquivalentMinutes(6.66, pricing(0.06, 0.0066))).toBe(
      "1 hour",
    )
    expect(allowanceEquivalentMinutes(6.66, pricing(0.12, 0.0132))).toBe(
      "30 minutes",
    )
    expect(allowanceEquivalentMinutes(0.02, pricing(0.06, 0.0066))).toBe(
      "Less than 1 minute",
    )
    expect(allowanceEquivalentMinutes(0, pricing(0.06, 0.0066))).toBe(
      "0 minutes",
    )
  })
  it("doesn't guess from missing, negative, ambiguous or invalid rates", () => {
    for (const rates of [
      undefined,
      pricing(0, 0),
      pricing(-0.1, 0.2),
      pricing(NaN, 0.1),
      { ...pricing(0.1, 0.1), currency: "EUR" },
      { ...pricing(0.1, 0.1), rates: [] },
    ])
      expect(allowanceEquivalentMinutes(13.32, rates)).toBeNull()
  })
})
