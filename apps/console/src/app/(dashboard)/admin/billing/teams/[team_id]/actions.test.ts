import { beforeEach, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/cells", () => ({ configuredRegions: () => ["use"] }))
vi.mock("@/lib/admin/billing-api", async () => {
  const actual = await vi.importActual<object>("@/lib/admin/billing-api")
  return { ...actual, requireAdminBilling: vi.fn() }
})
vi.mock("@/lib/admin/team-billing", async () => {
  const actual = await vi.importActual<object>("@/lib/admin/team-billing")
  return {
    ...actual,
    requestPlanChange: vi.fn(),
    undoPlanChange: vi.fn(),
    assignTeamPlan: vi.fn(),
    getPlanCatalog: vi.fn(),
    grantStaffCredit: vi.fn(),
  }
})

import { AdminBillingRequestError } from "@/lib/admin/billing-api"
import {
  assignTeamPlan,
  getPlanCatalog,
  grantStaffCredit,
  requestPlanChange,
  undoPlanChange,
} from "@/lib/admin/team-billing"

import {
  assignTeamPlanAction,
  grantStaffCreditAction,
  requestPlanChangeAction,
  undoPlanChangeAction,
} from "./actions"

const team = "22222222-2222-4222-8222-222222222222"
const valid = {
  region: "use",
  teamId: team,
  idempotencyKey: "key-1",
  targetPlan: "free" as const,
  reason: "downgrade",
}

beforeEach(() => {
  vi.mocked(requestPlanChange).mockReset()
  vi.mocked(undoPlanChange).mockReset()
  vi.mocked(assignTeamPlan).mockReset()
  vi.mocked(getPlanCatalog).mockResolvedValue({
    pricingV2: true,
    assignablePlans: [],
    freeLimits: null,
  })
})

it("allows downgrades and undo but refuses new assignments while pricing v2 is off", async () => {
  vi.mocked(getPlanCatalog).mockResolvedValue({
    pricingV2: false,
    assignablePlans: [],
    freeLimits: null,
  })
  const off = { kind: "conflict", detail: "pricing v2 is off in this region" }
  vi.mocked(requestPlanChange).mockResolvedValue({
    effective_at: "2026-12-05T14:20:00Z",
  } as never)
  expect(await requestPlanChangeAction(valid)).toEqual({
    kind: "saved",
    effectiveAt: "2026-12-05T14:20:00Z",
  })
  expect(
    await undoPlanChangeAction({
      region: "use",
      teamId: team,
      changeId: "33333333-3333-4333-8333-333333333333",
      reason: "r",
    }),
  ).toEqual({ kind: "saved" })
  expect(
    await assignTeamPlanAction({
      region: "use",
      teamId: team,
      idempotencyKey: "k",
      versionId: "44444444-4444-4444-8444-444444444444",
      reason: "enterprise agreement",
    }),
  ).toEqual(off)
  expect(requestPlanChange).toHaveBeenCalled()
  expect(undoPlanChange).toHaveBeenCalled()
  expect(assignTeamPlan).not.toHaveBeenCalled()
})

it("rejects malformed targets before calling the backend", async () => {
  for (const input of [
    { ...valid, region: "eu" },
    { ...valid, teamId: "../billing" },
    { ...valid, reason: "   " },
    { ...valid, idempotencyKey: "" },
    { ...valid, targetPlan: "pro_annual" as never },
  ]) {
    expect(await requestPlanChangeAction(input)).toEqual({ kind: "invalid" })
  }
  expect(
    await assignTeamPlanAction({
      region: "use",
      teamId: team,
      idempotencyKey: "k",
      versionId: "enterprise",
      reason: "r",
    }),
  ).toEqual({ kind: "invalid" })
  expect(
    await undoPlanChangeAction({
      region: "use",
      teamId: team,
      changeId: "x",
      reason: "r",
    }),
  ).toEqual({ kind: "invalid" })
  expect(requestPlanChange).not.toHaveBeenCalled()
  expect(undoPlanChange).not.toHaveBeenCalled()
  expect(assignTeamPlan).not.toHaveBeenCalled()
})

it("maps backend failures to their kind", async () => {
  vi.mocked(requestPlanChange).mockRejectedValue(
    new AdminBillingRequestError("conflict"),
  )
  expect(await requestPlanChangeAction(valid)).toEqual({ kind: "conflict" })
  vi.mocked(requestPlanChange).mockRejectedValue(new Error("socket hang up"))
  expect(await requestPlanChangeAction(valid)).toEqual({ kind: "unavailable" })
  vi.mocked(requestPlanChange).mockResolvedValue({
    effective_at: "2026-12-05T14:20:00Z",
  } as never)
  expect(await requestPlanChangeAction(valid)).toEqual({
    kind: "saved",
    effectiveAt: "2026-12-05T14:20:00Z",
  })
  expect(requestPlanChange).toHaveBeenLastCalledWith("use", team, {
    idempotencyKey: "key-1",
    targetPlan: "free",
    reason: "downgrade",
  })
})

it("passes the backend's reason through with the failure kind", async () => {
  vi.mocked(requestPlanChange).mockRejectedValue(
    new AdminBillingRequestError(
      "conflict",
      "the team already has a pending plan change",
    ),
  )
  expect(await requestPlanChangeAction(valid)).toEqual({
    kind: "conflict",
    detail: "the team already has a pending plan change",
  })
})

it("validates staff credit amounts before calling the backend", async () => {
  const credit = {
    region: "use",
    teamId: team,
    idempotencyKey: "k",
    amountCents: 2500,
    reason: "goodwill",
  }
  for (const amountCents of [0, -1, 1.5, 100_000_001]) {
    expect(await grantStaffCreditAction({ ...credit, amountCents })).toEqual({
      kind: "invalid",
    })
  }
  expect(grantStaffCredit).not.toHaveBeenCalled()
  vi.mocked(grantStaffCredit).mockResolvedValue({} as never)
  expect(await grantStaffCreditAction(credit)).toEqual({ kind: "saved" })
  expect(grantStaffCredit).toHaveBeenCalledWith("use", team, {
    idempotencyKey: "k",
    amountCents: 2500,
    reason: "goodwill",
  })
})
