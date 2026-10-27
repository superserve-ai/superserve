import { describe, expect, it } from "vitest"

import { planLimitsSchema, publicBillingPlansSchema } from "./plans"

const limits = {
  max_concurrent: 1,
  max_vcpu: 1,
  max_memory_mib: 1024,
  max_disk_mib: 8192,
  max_templates: 0,
}

describe("zero template entitlement", () => {
  it("accepts published Free catalog cards with templates disabled", () => {
    const catalog = {
      pricing_version: "v2",
      cards: [
        {
          family: "free",
          version: 2,
          kind: "free",
          name: "Free",
          price_label: "Free",
          tagline: "",
          features: [],
          display_only: false,
          monthly: null,
          annual: null,
          credit_summary: "",
          monthly_credit_cents: null,
          allowance: null,
          matching: null,
          limits,
        },
      ],
    }
    expect(
      publicBillingPlansSchema.parse(catalog).cards[0].limits.max_templates,
    ).toBe(0)
  })
  it.each([0, 10, null])("preserves configured template cap %s", (cap) => {
    expect(
      planLimitsSchema.parse({ ...limits, max_templates: cap }).max_templates,
    ).toBe(cap)
  })
  it.each([-1, 0.5])("rejects invalid template cap %s", (cap) => {
    expect(
      planLimitsSchema.safeParse({ ...limits, max_templates: cap }).success,
    ).toBe(false)
  })
})
