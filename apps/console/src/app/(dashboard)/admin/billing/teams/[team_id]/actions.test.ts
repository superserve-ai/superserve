import { beforeEach, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/cells", () => ({ configuredRegions: () => ["use"] }))
vi.mock("@/lib/admin/impersonation", () => ({
  hasImpersonationCookie: vi.fn(async () => false),
}))
vi.mock("@/lib/admin/team-billing", async () => {
  const actual = await vi.importActual<object>("@/lib/admin/team-billing")
  return {
    ...actual,
    schedulePlanChange: vi.fn(),
    cancelPlanChange: vi.fn(),
    grantStaffCredit: vi.fn(),
  }
})

import { AdminBillingRequestError } from "@/lib/admin/billing-api"
import { hasImpersonationCookie } from "@/lib/admin/impersonation"
import {
  cancelPlanChange,
  grantStaffCredit,
  schedulePlanChange,
} from "@/lib/admin/team-billing"

import {
  cancelPlanChangeAction,
  grantStaffCreditAction,
  schedulePlanChangeAction,
} from "./actions"

const team = "22222222-2222-4222-8222-222222222222"
const valid = {
  region: "use",
  teamId: team,
  idempotencyKey: "key-1",
  targetOffer: "pro_monthly",
  reason: "upgrade",
}

beforeEach(() => {
  vi.mocked(schedulePlanChange).mockReset()
  vi.mocked(cancelPlanChange).mockReset()
})

it("rejects malformed targets before calling the backend", async () => {
  for (const input of [
    { ...valid, region: "eu" },
    { ...valid, teamId: "../billing" },
    { ...valid, reason: "   " },
    { ...valid, idempotencyKey: "" },
  ]) {
    expect(await schedulePlanChangeAction(input)).toEqual({ kind: "invalid" })
  }
  expect(
    await cancelPlanChangeAction({
      region: "use",
      teamId: team,
      changeId: "x",
      reason: "r",
    }),
  ).toEqual({ kind: "invalid" })
  expect(schedulePlanChange).not.toHaveBeenCalled()
  expect(cancelPlanChange).not.toHaveBeenCalled()
})

it("maps backend failures to their kind", async () => {
  vi.mocked(schedulePlanChange).mockRejectedValue(
    new AdminBillingRequestError("conflict"),
  )
  expect(await schedulePlanChangeAction(valid)).toEqual({ kind: "conflict" })
  vi.mocked(schedulePlanChange).mockRejectedValue(new Error("socket hang up"))
  expect(await schedulePlanChangeAction(valid)).toEqual({ kind: "unavailable" })
  vi.mocked(schedulePlanChange).mockResolvedValue({} as never)
  expect(await schedulePlanChangeAction(valid)).toEqual({ kind: "saved" })
  expect(schedulePlanChange).toHaveBeenLastCalledWith("use", team, {
    idempotencyKey: "key-1",
    targetOffer: "pro_monthly",
    reason: "upgrade",
  })
})

it("refuses billing writes while impersonating a team", async () => {
  vi.mocked(hasImpersonationCookie).mockResolvedValueOnce(true)
  expect(await schedulePlanChangeAction(valid)).toEqual({
    kind: "impersonating",
  })
  vi.mocked(hasImpersonationCookie).mockResolvedValueOnce(true)
  expect(
    await cancelPlanChangeAction({
      region: "use",
      teamId: team,
      changeId: "33333333-3333-4333-8333-333333333333",
      reason: "r",
    }),
  ).toEqual({ kind: "impersonating" })
  vi.mocked(hasImpersonationCookie).mockResolvedValueOnce(true)
  expect(
    await grantStaffCreditAction({
      region: "use",
      teamId: team,
      idempotencyKey: "k",
      amountCents: 100,
      reason: "r",
    }),
  ).toEqual({ kind: "impersonating" })
  expect(schedulePlanChange).not.toHaveBeenCalled()
  expect(cancelPlanChange).not.toHaveBeenCalled()
  expect(grantStaffCredit).not.toHaveBeenCalled()
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
