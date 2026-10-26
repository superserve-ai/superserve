import { describe, expect, it } from "vitest"

import {
  proCheckoutSchema,
  proCheckoutPlanSchema,
  teamPlanSchema,
} from "./billing-v2"
const raw = {
  plan: {
    plan_key: "free",
    kind: "free",
    display_name: "Free",
    effective_from: "2026-10-26T00:00:00Z",
    limits: {
      max_concurrent: 1,
      max_templates: null,
      max_vcpu: 1,
      max_memory_mib: 1024,
      max_disk_mib: 4096,
    },
  },
  period: { start: "2026-10-26T00:00:00Z", end: "2026-11-01T00:00:00Z" },
  pending_change: null,
}
describe("Pro checkout plan response", () => {
  it("preserves verified candidate without inferring from current plan", () => {
    expect(teamPlanSchema.parse(raw)).not.toHaveProperty("pro_checkout")
    expect(
      teamPlanSchema.parse({
        ...raw,
        pro_checkout: { first_paid_pro_cycle: true, accepted: false },
      })?.pro_checkout,
    ).toEqual({ first_paid_pro_cycle: true, accepted: false })
  })
  it("retains frozen independent fee/credit and RFC3339 offsets", () => {
    const checkout = {
      first_paid_pro_cycle: true,
      accepted: true,
      first_payment_cents: 25000,
      first_credit_cents: 40000,
      period_start: "2026-10-26T12:00:00+00:00",
      period_end: "2026-11-26T12:00:00Z",
      credit_expires_at: "2026-11-26T12:00:00Z",
    }
    expect(
      teamPlanSchema.parse({ ...raw, pro_checkout: checkout })?.pro_checkout,
    ).toEqual(checkout)
  })
  it.each([
    { accepted: "true", first_paid_pro_cycle: true },
    { accepted: true, first_paid_pro_cycle: true, first_payment_cents: -1 },
    { accepted: true, first_paid_pro_cycle: true, first_credit_cents: 0.5 },
    { accepted: true, first_paid_pro_cycle: true, period_end: "not-a-date" },
  ])("rejects malformed quote %o", (checkout) => {
    expect(proCheckoutSchema.safeParse(checkout).success).toBe(false)
  })
})

it("preserves first-cycle terms independently of a missing current assignment", () => {
  const checkout = { first_paid_pro_cycle: true, accepted: false }
  const response = { ...raw, plan: null, pro_checkout: checkout }
  expect(teamPlanSchema.parse(response)).toBeNull()
  expect(proCheckoutPlanSchema.parse(response)).toEqual(checkout)
  expect(proCheckoutPlanSchema.parse({ ...raw, plan: null })).toBeNull()
  expect(proCheckoutPlanSchema.parse(raw)).toBeNull()
})
it("preserves a frozen accepted quote without an assignment", () => {
  const checkout = {
    first_paid_pro_cycle: true,
    accepted: true,
    first_payment_cents: 25000,
    first_credit_cents: 40000,
    period_start: "2026-10-26T12:00:00Z",
    period_end: "2026-11-26T12:00:00Z",
    credit_expires_at: "2026-11-26T12:00:00Z",
  }
  expect(
    proCheckoutPlanSchema.parse({ ...raw, plan: null, pro_checkout: checkout }),
  ).toEqual(checkout)
})
