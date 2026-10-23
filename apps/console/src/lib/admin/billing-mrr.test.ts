import { describe, expect, it } from "vitest"

import {
  combineMRR,
  formatUSD,
  type MRROverview,
  mrrOverviewSchema,
  mrrShare,
} from "./billing-mrr"

function overview(region: string, plans: MRROverview["plans"]): MRROverview {
  return {
    as_of: "2026-10-23T16:00:00Z",
    region,
    currency: "usd",
    mrr_cents: plans.reduce((sum, p) => sum + p.mrr_cents, 0),
    teams: plans.reduce((sum, p) => sum + p.teams, 0),
    revenue_teams: plans
      .filter((p) => p.mrr_cents > 0)
      .reduce((sum, p) => sum + p.teams, 0),
    plans,
  }
}

describe("combineMRR", () => {
  it("sums plans across regions and keeps pay as you go last", () => {
    const combined = combineMRR([
      {
        region: "use",
        overview: overview("use", [
          {
            key: "pro_monthly",
            name: "Pro monthly",
            teams: 2,
            mrr_cents: 240000,
          },
          { key: "payg", name: "Pay as you go", teams: 50, mrr_cents: 0 },
        ]),
      },
      {
        region: "usw",
        overview: overview("usw", [
          { key: "yc_2026", name: "YC 2026", teams: 3, mrr_cents: 300000 },
          {
            key: "pro_monthly",
            name: "Pro monthly",
            teams: 1,
            mrr_cents: 120000,
          },
          {
            key: "sponsored_usage",
            name: "Sponsored credits",
            teams: 4,
            mrr_cents: 0,
          },
          { key: "payg", name: "Pay as you go", teams: 10, mrr_cents: 0 },
        ]),
      },
    ])
    expect(combined.mrrCents).toBe(660000)
    expect(combined.teams).toBe(70)
    expect(combined.revenueTeams).toBe(6)
    expect(combined.plans.map((p) => [p.key, p.teams, p.mrr_cents])).toEqual([
      ["pro_monthly", 3, 360000],
      ["yc_2026", 3, 300000],
      ["sponsored_usage", 4, 0],
      ["payg", 60, 0],
    ])
  })

  it("reports regions that did not answer instead of counting them as zero", () => {
    const combined = combineMRR([
      { region: "use", overview: overview("use", []) },
      { region: "usw", kind: "forbidden" },
    ])
    expect(combined.regions).toEqual(["use"])
    expect(combined.failures).toEqual([{ region: "usw", kind: "forbidden" }])
  })
})

describe("mrrOverviewSchema", () => {
  it("rejects fractional or negative cents", () => {
    const valid = overview("use", [
      { key: "pro_annual", name: "Pro annual", teams: 1, mrr_cents: 100000 },
    ])
    expect(mrrOverviewSchema.safeParse(valid).success).toBe(true)
    expect(
      mrrOverviewSchema.safeParse({ ...valid, mrr_cents: 1.5 }).success,
    ).toBe(false)
    expect(mrrOverviewSchema.safeParse({ ...valid, teams: -1 }).success).toBe(
      false,
    )
  })
})

describe("formatting", () => {
  it("formats whole and fractional dollars", () => {
    expect(formatUSD(100000)).toBe("$1,000")
    expect(formatUSD(833333)).toBe("$8,333.33")
    expect(formatUSD(100000, true)).toBe("$1,000.00")
  })

  it("has no share when there is no revenue", () => {
    expect(mrrShare(0, 0)).toBe(0)
    expect(mrrShare(25, 100)).toBe(0.25)
    expect(mrrShare(150, 100)).toBe(1)
  })
})
