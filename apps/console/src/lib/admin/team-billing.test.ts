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
} from "@/lib/admin/billing-api"

import {
  cancelPlanChange,
  listBillingTeams,
  schedulePlanChange,
  teamPlanBillingSchema,
} from "./team-billing"

const team = "22222222-2222-4222-8222-222222222222"

beforeEach(() => vi.mocked(adminBillingRequest).mockReset())

describe("listBillingTeams", () => {
  it("merges regions and reports the ones that failed", async () => {
    vi.mocked(adminBillingRequest).mockImplementation(async (request) => {
      if (request?.region === "usw")
        throw new AdminBillingRequestError("unavailable")
      return {
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
    const { teams, unavailableRegions } = await listBillingTeams("a")
    expect(unavailableRegions).toEqual(["usw"])
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

describe("plan change writes", () => {
  it("posts the frozen request to the team's billing route", async () => {
    vi.mocked(adminBillingRequest).mockResolvedValue({})
    await schedulePlanChange("use", team, {
      idempotencyKey: "key-1",
      targetOffer: "pro_monthly",
      reason: "upgrade",
    })
    await cancelPlanChange("use", team, "change-1", "mistake")
    const [schedule, cancel] = vi
      .mocked(adminBillingRequest)
      .mock.calls.map(([request]) => request)
    expect(schedule).toMatchObject({
      region: "use",
      method: "POST",
      path: `/internal/teams/${team}/billing/plan-changes`,
      body: {
        idempotency_key: "key-1",
        target_offer: "pro_monthly",
        reason: "upgrade",
      },
    })
    expect(cancel).toMatchObject({
      method: "POST",
      path: `/internal/teams/${team}/billing/plan-changes/change-1/cancel`,
      body: { reason: "mistake" },
    })
  })
})

describe("teamPlanBillingSchema", () => {
  it("accepts the backend team view", () => {
    const parsed = teamPlanBillingSchema.safeParse({
      team_id: team,
      customer_id: "cus_example",
      subscription_id: "sub_example",
      subscription_status: "active",
      billing_anchor: "2026-09-23T16:00:00Z",
      period_start: "2026-10-23T16:00:00Z",
      period_end: "2026-11-23T16:00:00Z",
      contract: {
        id: "c1",
        team_id: team,
        offer_key: "pro_monthly",
        status: "active",
        starts_at: "2026-10-23T16:00:00Z",
        ends_at: null,
        charge_kind: "subscription",
        charge_amount_cents: 120000,
        charge_interval_months: 1,
        entitlement_amount_cents: 100000,
        entitlement_cadence: "monthly",
      },
      pending_change: null,
      changes: [
        {
          id: "p1",
          target_offer: "pro_monthly",
          terms: {
            offer_key: "pro_monthly",
            fee_cents: 120000,
            interval_months: 1,
            monthly_credit_cents: 100000,
          },
          effective_at: "2026-10-23T16:00:00Z",
          state: "completed",
          requested_by: "u1",
          requested_at: "2026-10-20T16:00:00Z",
          reason: "upgrade",
          deferrals: 0,
          cancelable: false,
          canceled_at: null,
          canceled_by: null,
          cancel_reason: null,
          from_contract_id: null,
          to_contract_id: "c1",
          prepared_at: null,
          switched_at: null,
          completed_at: null,
          last_error: null,
        },
      ],
      credits: [
        {
          period_start: "2026-10-23T16:00:00Z",
          period_end: "2026-11-23T16:00:00Z",
          amount_cents: 100000,
          state: "issued",
          grant_id: "credgr_example",
          remaining_cents: 25000,
        },
      ],
      card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2030 },
      invoices: [],
      plan_options: [
        {
          offer_key: "pro_monthly",
          fee_cents: 120000,
          interval_months: 1,
          monthly_credit_cents: 100000,
          name: "Pro",
          available: true,
        },
      ],
    })
    expect(parsed.success).toBe(true)
  })
})
