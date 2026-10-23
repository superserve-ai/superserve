import { describe, expect, it } from "vitest"

import {
  type CatalogPlan,
  catalogPlansOf,
  PLAN_ACTION_LINKS,
  planAction,
  type TeamPlan,
} from "./billing-v2"

const limits = {
  max_concurrent: 1,
  max_vcpu: 1,
  max_memory_mib: 1024,
  max_disk_mib: 4096,
  max_templates: null,
}
const card = (
  key: string,
  kind: CatalogPlan["kind"],
  name: string,
): CatalogPlan => ({
  key,
  kind,
  name,
  price_label: name,
  available: true,
  fee_cents: null,
  included_cents: null,
  limits,
})
const FREE = card("free", "free", "Free")
const STARTER = card("starter", "prepaid", "Starter")
const PRO = card("pro_monthly", "subscription", "Pro")
const ENTERPRISE = card("enterprise", "custom", "Enterprise")

function team(c: CatalogPlan, pending: string | null = null): TeamPlan {
  return {
    key: c.key,
    kind: c.kind,
    name: c.name,
    limits,
    fee_cents: null,
    included_cents: null,
    period_start: null,
    period_end: null,
    pending_change: pending
      ? {
          id: "34971786-dd50-492b-b934-306b63764c4b",
          pauses_running: true,
          plan_key: pending,
          plan_name: pending,
          effective_at: "2026-11-01T00:00:00Z",
          undoable: true,
        }
      : null,
  }
}

describe("planAction", () => {
  it("upgrades through the purchase pages", () => {
    expect(planAction(team(FREE), STARTER)).toEqual({
      type: "link",
      href: PLAN_ACTION_LINKS.starter,
      label: "Get Starter",
    })
    expect(planAction(team(FREE), PRO)).toMatchObject({
      href: PLAN_ACTION_LINKS.pro,
    })
    expect(planAction(team(STARTER), PRO)).toMatchObject({
      href: PLAN_ACTION_LINKS.pro,
    })
    expect(planAction(team(FREE), ENTERPRISE)).toMatchObject({
      href: PLAN_ACTION_LINKS.enterprise,
      label: "Book a meeting",
    })
  })

  it("lets legacy pay-as-you-go teams buy Starter or Pro", () => {
    const legacy = team(card("legacy", "legacy_payg", "Pay as you go"))
    expect(planAction(legacy, STARTER)).toMatchObject({
      href: PLAN_ACTION_LINKS.starter,
    })
    expect(planAction(legacy, PRO)).toMatchObject({
      href: PLAN_ACTION_LINKS.pro,
    })
    expect(planAction(legacy, FREE)).toEqual({
      type: "downgrade",
      label: "Switch to Free",
    })
  })

  it("downgrades through a scheduled change", () => {
    expect(planAction(team(PRO), STARTER)).toEqual({
      type: "downgrade",
      label: "Switch to Starter",
    })
    expect(planAction(team(PRO), FREE)).toEqual({
      type: "downgrade",
      label: "Switch to Free",
    })
    expect(planAction(team(STARTER), FREE)).toEqual({
      type: "downgrade",
      label: "Switch to Free",
    })
    expect(planAction(team(ENTERPRISE), FREE)).toEqual({
      type: "downgrade",
      label: "Switch to Free",
    })
  })

  it("marks the current and scheduled plans and sends Enterprise teams to us", () => {
    expect(planAction(team(PRO), PRO)).toEqual({ type: "current" })
    expect(planAction(team(PRO, "free"), FREE)).toEqual({ type: "scheduled" })
    expect(planAction(team(ENTERPRISE), PRO)).toEqual({ type: "contact" })
    expect(planAction(team(ENTERPRISE), STARTER)).toEqual({ type: "contact" })
  })
})

describe("planAction edge cases", () => {
  it("treats the same kind under a different key as current or contact", () => {
    const legacyPro = { ...team(PRO), key: "pro_annual" }
    expect(planAction(legacyPro, PRO)).toEqual({ type: "contact" })
    expect(planAction({ ...team(FREE), key: "free_legacy" }, FREE)).toEqual({
      type: "current",
    })
  })

  it("blocks upgrades while a downgrade is scheduled", () => {
    expect(planAction(team(STARTER, "free"), PRO)).toEqual({
      type: "blocked",
      undoable: true,
      effectiveAt: "2026-11-01T00:00:00Z",
    })
  })
})

describe("catalogPlansOf", () => {
  const free = {
    family: "free",
    version: 1,
    kind: "free",
    name: "Free",
    price_label: "$0",
    tagline: "Explore",
    features: [],
    display_only: false,
    monthly: null,
    annual: null,
    credit_summary: "",
    monthly_credit_cents: null,
    allowance: {
      amount_cents: 13,
      period: "day_window",
      on_exhausted: "pause",
      summary: "2h per 24-hour window",
      compute: { seconds: 7200, vcpu: 1, memory_gib: 1 },
    },
    matching: null,
    limits,
  }
  it("reads actual cards without interpreting legacy offers as cards", () => {
    const plans = catalogPlansOf({
      pricing_version: "v2",
      cards: [
        free,
        {
          ...free,
          family: "pro",
          kind: "subscription",
          name: "Pro",
          price_label: "$250/month",
          monthly: {
            offer_key: "pro_monthly",
            price_cents: 25000,
            monthly_equivalent_cents: 25000,
            available: false,
          },
          allowance: {
            amount_cents: 25000,
            period: "month",
            on_exhausted: "payg",
            summary: "$250 per month",
          },
        },
      ],
      plans: [{ key: "old_offer", family: "old", price_cents: 100000 }],
    })
    expect(plans.map((plan) => plan.key)).toEqual(["free", "pro_monthly"])
    expect(plans[1]).toMatchObject({
      fee_cents: 25000,
      included_cents: 25000,
      price_label: "$250/month",
      available: false,
    })
    expect(planAction(team(FREE), plans[1])).toEqual({ type: "unavailable" })
  })
  it("surfaces malformed catalogs as failures instead of empty successful data", () => {
    expect(() => catalogPlansOf({ plans: [] })).toThrow()
    expect(() => catalogPlansOf({ cards: [{ family: "broken" }] })).toThrow()
  })
})
