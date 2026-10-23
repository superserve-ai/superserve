import { describe, expect, it } from "vitest"

import {
  catalogDrift,
  mergeCatalogs,
  needsSync,
  planGroupSync,
  promotionGroupSync,
  type BillingCatalog,
  type PlanVersion,
  type RegionState,
} from "./billing-catalog"

function version(overrides: Partial<PlanVersion> = {}): PlanVersion {
  return {
    id: "v1",
    family: "pro",
    version: 1,
    state: "published",
    public: true,
    display_name: "Pro",
    tagline: "",
    features: [],
    sort_order: 2,
    display_only: false,
    self_serve: true,
    monthly_fee_cents: 120000,
    annual_fee_cents: 1200000,
    credit_schedule: [],
    matching: null,
    limits: {
      max_sandboxes: 1000,
      max_template_vcpu: null,
      max_template_memory_mib: null,
      max_template_disk_mib: null,
    },
    created_at: "2026-10-01T00:00:00Z",
    published_at: "2026-10-01T00:00:00Z",
    retired_at: null,
    preview: { issues: [], summary: "No included credit", months: 24 },
    ...overrides,
  }
}

function catalog(plans: PlanVersion[], bonus = 10000): BillingCatalog {
  return {
    plans,
    promotions: [
      {
        id: "p1",
        promotion: "card_bonus",
        version: 1,
        state: "published",
        amount_cents: bonus,
        published_at: null,
        retired_at: null,
      },
    ],
  }
}

describe("catalogDrift", () => {
  it("ignores version identity and timestamps when terms match", () => {
    expect(
      catalogDrift({
        use: catalog([version()]),
        usw: catalog([
          version({
            id: "v9",
            version: 3,
            published_at: "2026-10-05T00:00:00Z",
          }),
        ]),
      }),
    ).toEqual([])
  })

  it("flags families and promotions whose published terms differ", () => {
    expect(
      catalogDrift({
        use: catalog([version()], 10000),
        usw: catalog([version({ monthly_fee_cents: 150000 })], 9500),
      }),
    ).toEqual(["pro", "card_bonus"])
  })

  it("flags a family published in only one region", () => {
    expect(
      catalogDrift({
        use: catalog([version(), version({ family: "starter", id: "s" })]),
        usw: catalog([version()]),
      }),
    ).toEqual(["starter"])
  })
})

describe("planGroupSync", () => {
  const m = (version: number, states: Record<string, RegionState>) => ({
    version,
    states,
  })

  it("brings lagging regions to the newest version that left draft", () => {
    expect(
      planGroupSync([
        m(2, { use: "published", usw: "missing" }),
        m(1, { use: "retired", usw: "published" }),
      ]),
    ).toEqual([
      { use: [], usw: ["create", "publish"] },
      { use: [], usw: [] },
    ])
    expect(planGroupSync([m(2, { use: "published", usw: "draft" })])).toEqual([
      { use: [], usw: ["publish"] },
    ])
  })

  it("never republishes an older version over a newer one", () => {
    expect(
      planGroupSync([
        m(2, { use: "published", usw: "draft" }),
        m(3, { use: "draft", usw: "published" }),
      ]),
    ).toEqual([
      { use: [], usw: [] },
      { use: ["publish"], usw: [] },
    ])
  })

  it("retires what is still published when the family was withdrawn", () => {
    expect(
      planGroupSync([
        m(2, { use: "retired", usw: "missing" }),
        m(1, { use: "retired", usw: "published" }),
      ]),
    ).toEqual([
      { use: [], usw: [] },
      { use: [], usw: ["retire"] },
    ])
  })

  it("finishes a retire that only reached some regions", () => {
    expect(planGroupSync([m(1, { use: "retired", usw: "published" })])).toEqual(
      [{ use: [], usw: ["retire"] }],
    )
  })

  it("leaves drafts alone so a partial delete is not undone", () => {
    expect(planGroupSync([m(4, { use: "missing", usw: "draft" })])).toEqual([
      { use: [], usw: [] },
    ])
  })
})

describe("promotionGroupSync", () => {
  it("creates only the newest published promotion where it is missing", () => {
    expect(
      promotionGroupSync([
        { version: 2, states: { use: "published", usw: "missing" } },
        { version: 3, states: { use: "missing", usw: "published" } },
      ]),
    ).toEqual([
      { use: [], usw: [] },
      { use: ["create"], usw: [] },
    ])
  })
})

describe("promotion ties", () => {
  it("does not sync promotions that share a version number", () => {
    expect(
      promotionGroupSync([
        { version: 3, states: { use: "published", usw: "missing" } },
        { version: 3, states: { use: "missing", usw: "published" } },
      ]),
    ).toEqual([
      { use: [], usw: [] },
      { use: [], usw: [] },
    ])
  })
})

describe("mergeCatalogs", () => {
  it("joins versions by id and reports their state per region", () => {
    const merged = mergeCatalogs({
      use: catalog([version({ state: "published" })]),
      usw: catalog([version({ state: "draft" })]),
    })
    expect(merged.versions).toHaveLength(1)
    expect(merged.versions[0]!.version.state).toBe("published")
    expect(merged.versions[0]!.states).toEqual({
      use: "published",
      usw: "draft",
    })
    expect(needsSync(merged.versions[0]!.steps)).toBe(true)
  })
})
