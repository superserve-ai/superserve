import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("@/lib/admin/billing-api", async () => {
  const actual = await vi.importActual<object>("@/lib/admin/billing-api")
  return { ...actual, adminBillingRequest: vi.fn() }
})
vi.mock("@/lib/cells", () => ({ configuredRegions: () => ["use", "usw"] }))

import {
  adminBillingRequest,
  AdminBillingRequestError,
  isAdminBillingPath,
} from "@/lib/admin/billing-api"

import {
  assignTeamPlan,
  billingCatalogSchema,
  getPlanCatalog,
  listBillingTeams,
  requestPlanChange,
  teamPlanAssignmentsSchema,
  undoPlanChange,
} from "./team-billing"

const team = "22222222-2222-4222-8222-222222222222"

beforeEach(() => vi.mocked(adminBillingRequest).mockReset())

describe("listBillingTeams", () => {
  it("merges regions and reports the ones that failed", async () => {
    vi.mocked(adminBillingRequest).mockImplementation(async (request) => {
      if (request?.region === "usw")
        throw new AdminBillingRequestError("unavailable")
      return {
        pagination: { total: 52 },
        rows: [
          { team_id: team, team_name: "Zeta", summary: null },
          {
            team_id: "44444444-4444-4444-8444-444444444444",
            team_name: "Acme",
            summary: { current_charges_usd: 12.5, credits_remaining_usd: 3 },
          },
        ],
      }
    })
    const { teams, unavailableRegions, hiddenTeams, allRegionsUnavailable } =
      await listBillingTeams("a")
    expect(unavailableRegions).toEqual(["usw"])
    expect(hiddenTeams).toBe(50)
    expect(allRegionsUnavailable).toBe(false)
    expect(
      teams.map((t) => [t.teamName, t.region, t.currentChargesUsd]),
    ).toEqual([
      ["Acme", "use", 12.5],
      ["Zeta", "use", null],
    ])
    const query = vi.mocked(adminBillingRequest).mock.calls[0][0].query
    expect(query?.get("search")).toBe("a")
    expect(query?.get("sort")).toBe("team_name")
  })
})

describe("plan writes", () => {
  it("posts each request to an allowlisted operator route", async () => {
    vi.mocked(adminBillingRequest).mockResolvedValue({})
    const change = "33333333-3333-4333-8333-333333333333"
    const version = "44444444-4444-4444-8444-444444444444"
    await requestPlanChange("use", team, {
      idempotencyKey: "key-1",
      targetPlan: "free",
      reason: "customer asked",
    })
    await undoPlanChange("use", team, change, "mistake")
    await assignTeamPlan("use", team, {
      idempotencyKey: "key-2",
      versionId: version,
      reason: "enterprise agreement",
    })
    const [request, undo, assign] = vi
      .mocked(adminBillingRequest)
      .mock.calls.map(([call]) => call)
    for (const call of [request, undo, assign])
      expect(isAdminBillingPath(call.path, "POST")).toBe(true)
    expect(
      isAdminBillingPath(
        `/internal/teams/${team}/billing/plan-changes/${change}/cancel`,
        "POST",
      ),
    ).toBe(false)
    expect(
      isAdminBillingPath(
        `/internal/teams/${team}/billing/sponsored-entitlements`,
        "POST",
      ),
    ).toBe(false)
    expect(request).toMatchObject({
      region: "use",
      method: "POST",
      path: `/internal/teams/${team}/billing/plan-changes`,
      body: {
        idempotency_key: "key-1",
        target_plan: "free",
        reason: "customer asked",
      },
    })
    expect(undo).toMatchObject({
      method: "POST",
      path: `/internal/teams/${team}/billing/plan-changes/${change}/undo`,
      body: { reason: "mistake" },
    })
    expect(assign).toMatchObject({
      method: "POST",
      path: `/internal/teams/${team}/billing/plan-assignments`,
      body: {
        idempotency_key: "key-2",
        version_id: version,
        reason: "enterprise agreement",
      },
    })
  })
})

describe("getPlanCatalog", () => {
  const limits = { max_concurrent: 5000, max_vcpu: 16 }
  const plan = (id: string, extra: object) => ({
    id,
    pricing_version: "v2",
    family: id,
    version: 1,
    state: "published",
    kind: "custom",
    display_name: id,
    limits,
    ...extra,
  })
  const plans = [
    plan("free", { kind: "free", limits: { max_concurrent: 1, max_vcpu: 1 } }),
    plan("acme", {}),
    plan("draft", { state: "draft" }),
    plan("legacy", { pricing_version: "legacy" }),
    plan("fee", { monthly_fee_cents: 100000 }),
    plan("shown", { display_only: true }),
    plan("unbounded", { limits: { max_concurrent: null } }),
  ]

  it("keeps plan writes off unless the region reports pricing v2", async () => {
    for (const [body, v2] of [
      [{ plans }, false],
      [{ plans, pricing_version: "legacy" }, false],
      [{ plans, pricing_version: "v2" }, true],
    ] as const) {
      vi.mocked(adminBillingRequest).mockResolvedValue(
        billingCatalogSchema.parse(body),
      )
      expect((await getPlanCatalog("use")).pricingV2).toBe(v2)
    }
  })

  it("offers only custom plans the backend will assign", async () => {
    vi.mocked(adminBillingRequest).mockResolvedValue(
      billingCatalogSchema.parse({ plans, pricing_version: "v2" }),
    )
    const catalog = await getPlanCatalog("use")
    expect(catalog.assignablePlans.map((p) => p.id)).toEqual(["acme"])
    expect(catalog.freeLimits).toEqual({ max_concurrent: 1, max_vcpu: 1 })
  })
})

describe("teamPlanAssignmentsSchema", () => {
  const assignment = {
    id: "55555555-5555-4555-8555-555555555555",
    team_id: team,
    plan_key: "pro_monthly",
    kind: "subscription",
    plan_version_id: null,
    terms: { offer_key: "pro_monthly", display_name: "Pro", fee_cents: 25000 },
    limits: {
      max_concurrent: 1000,
      max_vcpu: 8,
      max_memory_mib: 32768,
      max_disk_mib: 102400,
      max_templates: null,
    },
    effective_from: "2026-11-05T14:20:00Z",
    effective_to: null,
    contract_id: null,
    source: "checkout",
    assigned_by: null,
    reason: "",
    idempotency_key: null,
  }

  it("rejects limits under other names instead of showing them as defaults", () => {
    expect(
      teamPlanAssignmentsSchema.safeParse({
        current: { ...assignment, limits: { max_sandboxes: 1000 } },
        history: [],
      }).success,
    ).toBe(false)
  })

  it("accepts the backend's staff read with and without a pending change", () => {
    expect(
      teamPlanAssignmentsSchema.safeParse({ current: null, history: [] })
        .success,
    ).toBe(true)
    expect(
      teamPlanAssignmentsSchema.safeParse({
        current: assignment,
        history: [assignment],
        pending_change: {
          id: "66666666-6666-4666-8666-666666666666",
          target_plan_key: "free",
          target_display_name: "Free",
          effective_at: "2026-12-05T14:20:00Z",
          undoable: true,
          pauses_running: true,
        },
      }).success,
    ).toBe(true)
  })
})
