import { describe, expect, it } from "vitest"

import { pickerPlans } from "./plan-picker"
import type { BillingOffer } from "./plans"

const offer = (
  offer_key: string,
  display_name: string,
  sellable = true,
): BillingOffer => ({
  offer_key,
  family: offer_key.split("_")[0]!,
  display_name,
  price_cents: 1100,
  interval_months: 1,
  included_credit_cents: 1100,
  funding_policy: "postpaid",
  topoff: null,
  sellable,
})

describe("pickerPlans", () => {
  it.each([
    ["missing", undefined],
    ["unreadable", null],
    ["without either plan", [offer("other_monthly", "Other")]],
  ])("keeps today's two plans when offers are %s", (_, offers) => {
    expect(pickerPlans(offers)).toEqual([
      { offer: "developer", label: "Developer", catalog: null },
      { offer: "pro_monthly", label: "Pro", catalog: null },
    ])
  })

  it("lists checkout-able offers in catalog order with catalog names", () => {
    const plans = pickerPlans([
      offer("pro_monthly", "Team"),
      offer("pro_annual", "Team"),
      offer("developer_monthly", "Builder"),
    ])
    expect(plans.map(({ offer, label }) => [offer, label])).toEqual([
      ["pro_monthly", "Team"],
      ["developer", "Builder"],
    ])
  })

  it("hides offers this team can't buy now", () => {
    expect(
      pickerPlans([
        offer("developer_monthly", "Builder", false),
        offer("pro_monthly", "Team"),
      ]).map((plan) => plan.offer),
    ).toEqual(["pro_monthly"])
    expect(pickerPlans([offer("developer_monthly", "Builder", false)])).toEqual(
      [],
    )
  })
})
