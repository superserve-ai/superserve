import { expect, it } from "vitest"

import {
  canStartAnyPlan,
  canStartPlan,
  parseBillingCapabilities,
} from "./billing-capabilities"

const team = "11111111-1111-4111-8111-111111111111"
function wire(model: "legacy" | "v2", open: boolean) {
  const fresh = model === "v2" && open
  return {
    schema_version: 1,
    team_id: team,
    pricing_version: model,
    admission_source: model === "v2" ? "new_team" : "legacy",
    entry_open: open,
    epoch: null,
    enrollment_epoch: null,
    fresh_entry: {
      starter: fresh,
      pro: fresh,
      auto_recharge: fresh,
      choose_free: fresh,
    },
    actions: { recover_payment: true, disable_auto_recharge: true },
    catalog: { pricing_version: model, cards: [], plans: [] },
  }
}
it("does not equate public signup availability with the old team's commercial model", () => {
  const old = parseBillingCapabilities(wire("legacy", true), `use:${team}`)
  expect(old.pricing_version).toBe("legacy")
  expect(Object.values(old.fresh_entry)).toEqual([false, false, false, false])
})
it("retains enrolled display and recovery when new entry closes", () => {
  const closed = parseBillingCapabilities(wire("v2", false), `use:${team}`)
  expect(closed.catalog.pricing_version).toBe("v2")
  expect(closed.actions.recover_payment).toBe(true)
  expect(closed.actions.disable_auto_recharge).toBe(true)
})
it.each([
  (v: ReturnType<typeof wire>) => ({ ...v, schema_version: 2 }),
  (v: ReturnType<typeof wire>) => ({
    ...v,
    team_id: "22222222-2222-4222-8222-222222222222",
  }),
  (v: ReturnType<typeof wire>) => ({
    ...v,
    catalog: { ...v.catalog, pricing_version: "legacy" },
  }),
  (v: ReturnType<typeof wire>) => ({ ...v, entry_open: false }),
  (v: ReturnType<typeof wire>) => ({ ...v, fresh_entry: undefined }),
])(
  "fails closed on skew, wrong identity, mismatched catalog or invalid admission",
  (change) => {
    expect(() =>
      parseBillingCapabilities(change(wire("v2", true)), `use:${team}`),
    ).toThrow()
  },
)

const offer = (offer_key: string, sellable: boolean) => ({
  offer_key,
  family: offer_key.split("_")[0],
  display_name: offer_key,
  price_cents: 900,
  interval_months: 1,
  included_credit_cents: 900,
  funding_policy: "postpaid",
  topoff: null,
  sellable,
})

it("keeps readable offers when one entry is malformed, and none when absent", () => {
  const parsed = parseBillingCapabilities(
    {
      ...wire("v2", true),
      offers: [
        offer("alpha_monthly", true),
        { offer_key: "broken" },
        offer("beta_monthly", false),
      ],
    },
    `use:${team}`,
  )
  expect(parsed.offers.map((o) => o.offer_key)).toEqual([
    "alpha_monthly",
    "beta_monthly",
  ])
  expect(
    parseBillingCapabilities(wire("v2", true), `use:${team}`).offers,
  ).toEqual([])
})

it("needs both the entry gate and a sellable offer to start a plan", () => {
  const open = parseBillingCapabilities(
    {
      ...wire("v2", true),
      offers: [offer("alpha_monthly", true), offer("beta_monthly", false)],
    },
    `use:${team}`,
  )
  const plan = (key: string) => ({ key, kind: "subscription" as const })
  expect(canStartPlan(open, plan("alpha_monthly"))).toBe(true)
  expect(canStartPlan(open, plan("beta_monthly"))).toBe(false)
  expect(canStartPlan(open, plan("unlisted_monthly"))).toBe(true)
  expect(canStartPlan(open, { key: "free", kind: "free" })).toBe(true)
  expect(canStartAnyPlan(open)).toBe(true)

  const closed = {
    ...open,
    fresh_entry: {
      ...open.fresh_entry,
      pro: false,
      starter: false,
      choose_free: false,
    },
  }
  expect(canStartPlan(closed, plan("alpha_monthly"))).toBe(false)
  expect(canStartPlan(closed, { key: "free", kind: "free" })).toBe(false)
  expect(canStartAnyPlan(closed)).toBe(false)
})

it("offers an upgrade from the default plans when only unrelated offers are listed", () => {
  const unrelated = parseBillingCapabilities(
    { ...wire("v2", true), offers: [offer("alpha_monthly", false)] },
    `use:${team}`,
  )
  expect(canStartAnyPlan(unrelated)).toBe(true)
  const upgradesOffSale = parseBillingCapabilities(
    {
      ...wire("v2", true),
      offers: [
        offer("developer_monthly", false),
        offer("pro_monthly", false),
        offer("alpha_monthly", true),
      ],
    },
    `use:${team}`,
  )
  expect(canStartAnyPlan(upgradesOffSale)).toBe(false)
})
