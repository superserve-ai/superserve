import { describe, expect, it } from "vitest"

import {
  catalogDrift,
  mergeCatalogs,
  needsSync,
  planGroupSync,
  type BillingCatalog,
  type PlanVersion,
  type RegionState,
} from "./billing-catalog"

function version(overrides: Partial<PlanVersion> = {}): PlanVersion {
  return {
    id: "v1",
    pricing_version: "legacy",
    family: "pro",
    version: 1,
    state: "published",
    kind: "subscription",
    public: true,
    display_name: "Pro",
    price_label: "",
    tagline: "",
    features: [],
    sort_order: 2,
    display_only: false,
    self_serve: true,
    monthly_fee_cents: 120000,
    annual_fee_cents: 1200000,
    credit_schedule: [],
    matching: null,
    allowance: null,
    limits: {
      max_concurrent: 1000,
      max_vcpu: null,
      max_memory_mib: null,
      max_disk_mib: null,
      max_templates: null,
    },
    created_at: "2026-10-01T00:00:00Z",
    published_at: "2026-10-01T00:00:00Z",
    retired_at: null,
    preview: { issues: [], summary: "No included credit", months: 24 },
    ...overrides,
  }
}

function catalog(plans: PlanVersion[]): BillingCatalog {
  return { plans, pricing_version: "legacy" }
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

  it("flags families whose published terms differ", () => {
    expect(
      catalogDrift({
        use: catalog([version()]),
        usw: catalog([version({ monthly_fee_cents: 150000 })]),
      }),
    ).toEqual(["legacy:pro"])
  })

  it("flags a family published in only one region", () => {
    expect(
      catalogDrift({
        use: catalog([version(), version({ family: "starter", id: "s" })]),
        usw: catalog([version()]),
      }),
    ).toEqual(["legacy:starter"])
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

  it("preserves a consistently published version below a retired one", () => {
    expect(
      planGroupSync([
        m(3, { use: "retired", usw: "retired" }),
        m(2, { use: "published", usw: "published" }),
      ]),
    ).toEqual([
      { use: [], usw: [] },
      { use: [], usw: [] },
    ])
  })

  it("completes an older draft's partial publication after a newer withdrawal", () => {
    expect(
      planGroupSync([
        m(3, { use: "retired", usw: "retired" }),
        m(2, { use: "published", usw: "draft" }),
      ]),
    ).toEqual([
      { use: [], usw: [] },
      { use: [], usw: ["publish"] },
    ])
  })

  it("preserves a lower publication while completing a newer partial withdrawal", () => {
    expect(
      planGroupSync([
        m(3, { use: "retired", usw: "published" }),
        m(2, { use: "published", usw: "draft" }),
      ]),
    ).toEqual([
      { use: [], usw: ["retire"] },
      { use: [], usw: [] },
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

describe("mergeCatalogs", () => {
  it("joins versions by id and reports their state per region", () => {
    const merged = mergeCatalogs({
      use: catalog([version({ state: "published" })]),
      usw: catalog([version({ state: "draft" })]),
    })
    expect(merged).toHaveLength(1)
    expect(merged[0]!.version.state).toBe("published")
    expect(merged[0]!.states).toEqual({
      use: "published",
      usw: "draft",
    })
    expect(needsSync(merged[0]!.steps)).toBe(true)
  })

  it("syncs each pricing model's version of a family on its own", () => {
    const legacy = version()
    const v2 = version({ id: "v2", pricing_version: "v2", version: 2 })
    const merged = mergeCatalogs({
      use: catalog([legacy, v2]),
      usw: catalog([legacy]),
    })
    expect(merged.map((m) => [m.version.id, m.steps])).toEqual([
      ["v1", { use: [], usw: [] }],
      ["v2", { use: [], usw: ["create", "publish"] }],
    ])
  })
})
