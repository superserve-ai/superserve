import type { User } from "@supabase/supabase-js"
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  accountTeamFallbackName,
  accountTeamFallbackOperationId,
} from "./account-team-name"
import {
  PromotionEvidenceError,
  type PreparedPromotionTeam,
} from "./promotion-device-evidence"

const mocks = vi.hoisted(() => ({
  publish: vi.fn(),
  recover: vi.fn(),
  prepare: vi.fn(),
  complete: vi.fn(),
  repairProfile: vi.fn(),
}))
vi.mock("./promotion-publication", () => ({
  publishAccountPromotion: mocks.publish,
}))
vi.mock("./promotion-device-evidence", () => ({
  PromotionEvidenceError: class extends Error {
    constructor(readonly code: string) {
      super(code)
      this.name = "PromotionEvidenceError"
    }
  },
  recoverPromotionTeam: mocks.recover,
  preparePromotionTeam: mocks.prepare,
  completePromotionTeam: mocks.complete,
}))
vi.mock("./team-directory", () => ({
  listTeamMembershipsForUserDetailed: async () => ({
    memberships: [],
    degradedRegions: [],
  }),
}))
vi.mock("@/lib/auth/google-signup-proof", () => ({ isGoogleUser: () => false }))
vi.mock("@/lib/auth/signup-evidence", () => ({
  readSignupEvidenceEntries: async () => [],
  clearEvaluatedSignupEvidence: async () => {},
}))
vi.mock("@/lib/auth/signup-restrictions", () => ({
  evaluateSignupRestriction: async () => {},
}))
vi.mock("@/lib/cells", () => ({
  DEFAULT_REGION: "use",
  configuredRegions: () => ["use", "usw"],
  cellFor: () => ({ createAdminClient: () => ({ from }) }),
}))
import { provisionTeam } from "./team-provisioning"
const user = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "user@test.com",
} as User
const teamId = "22222222-2222-4222-8222-222222222222"
const operationId = "33333333-3333-4333-8333-333333333333"
const rows = new Map<string, Record<string, unknown>[]>()
let failTable: string | undefined
let missingTable: string | undefined
let prepared: Record<string, unknown> | null
function from(table: string) {
  let filters: [string, unknown][] = []
  const query = {
    select: (_columns: string) => query,
    eq: (field: string, value: unknown) => {
      filters.push([field, value])
      return query
    },
    is: (field: string, value: unknown) => {
      filters.push([field, value])
      return query
    },
    limit: async () =>
      table === missingTable
        ? { data: null, error: { code: "42P01", message: "missing" } }
        : {
            data: (rows.get(table) ?? []).filter((row) =>
              filters.every(([key, value]) => (row[key] ?? null) === value),
            ),
            error: null,
          },
    single: async () => ({ data: { id: "owner-role" }, error: null }),
    upsert: mocks.repairProfile,
    insert: async (input: Record<string, unknown>) => {
      if (table === failTable) return { error: { message: "write failed" } }
      const existing = rows.get(table) ?? []
      if (
        existing.some((row) =>
          input.id
            ? row.id === input.id
            : row.team_id === input.team_id &&
              row.profile_id === input.profile_id,
        )
      )
        return { error: { code: "23505", message: "duplicate" } }
      rows.set(table, [...existing, { ...input }])
      return { error: null }
    },
  }
  return query
}
function create(name = "original", op: string | undefined = operationId) {
  return provisionTeam(
    "use",
    user.id,
    "untrusted@example.com",
    name,
    { user, observedAt: new Date().toISOString() },
    op,
  )
}
beforeEach(() => {
  missingTable = undefined
  vi.resetAllMocks()
  rows.clear()
  failTable = undefined
  prepared = null
  mocks.repairProfile.mockResolvedValue({ error: null })
  mocks.publish.mockResolvedValue({ authorityUnavailable: true })
  mocks.recover.mockImplementation(async () => prepared)
  mocks.prepare.mockImplementation(
    async (input) =>
      (prepared = {
        ...input,
        teamId,
        attemptId: "backend-attempt",
        state: "prepared",
      }),
  )
  mocks.complete.mockImplementation(
    async (input) =>
      (prepared = {
        ...input,
        state: "completed",
        outcome: "promotion_ineligible",
      }),
  )
})
it("recovers a committed tuple unchanged after membership failure and later publication recovery", async () => {
  failTable = "team_memberships"
  await expect(create()).rejects.toThrow("write failed")
  const binding = { ...prepared }
  expect(rows.get("team_member")).toHaveLength(1)
  mocks.publish.mockResolvedValue({ authorityUnavailable: false })
  failTable = undefined
  expect(await create("changed name")).toEqual({
    id: teamId,
    name: "original",
    region: "use",
  })
  expect(mocks.publish).toHaveBeenCalledTimes(1)
  expect(mocks.prepare).toHaveBeenCalledTimes(1)
  expect(mocks.complete).toHaveBeenLastCalledWith(binding)
  expect(rows.get("team_member")).toHaveLength(1)
  expect(rows.get("team_memberships")).toHaveLength(1)
  expect(rows.get("user_role_assignments")).toHaveLength(1)
})
it.each(["user_role_assignments", "team_memberships"])(
  "cannot restore a revoked/inactive %s on replay",
  async (table) => {
    await create()
    const row = rows.get(table)![0]
    if (table === "user_role_assignments")
      row.revoked_at = new Date().toISOString()
    else row.status = "inactive"
    await expect(create()).rejects.toThrow("Unable to verify existing")
    expect(rows.get(table)).toHaveLength(1)
    expect(rows.get(table)![0]).toEqual(row)
  },
)
it("uses the Auth-assigned random UUID for the automatic East intent", async () => {
  await provisionTeam("use", user.id, user.email!, "initial", {
    user,
    observedAt: new Date().toISOString(),
  })
  expect(mocks.recover).toHaveBeenCalledWith({
    userId: user.id,
    region: "use",
    operationId: user.id,
  })
})
it("does not republish or replace the locator after uncertain preparation", async () => {
  mocks.prepare.mockImplementationOnce(async (input) => {
    prepared = {
      ...input,
      teamId,
      attemptId: "backend-attempt",
      state: "prepared",
    }
    throw new Error("response lost")
  })
  await expect(create()).rejects.toThrow("response lost")
  await create()
  expect(mocks.prepare).toHaveBeenCalledTimes(1)
  expect(mocks.publish).toHaveBeenCalledTimes(1)
})
it("does not prepare after a failed recovery or recreate a deleted team", async () => {
  mocks.recover.mockRejectedValueOnce(new Error("old cell"))
  await expect(create()).rejects.toThrow("old cell")
  expect(mocks.prepare).not.toHaveBeenCalled()
  prepared = {
    userId: user.id,
    region: "use",
    operationId,
    teamId,
    name: "original",
    authorityUnavailable: true,
    state: "deleted",
  }
  mocks.complete.mockResolvedValueOnce(prepared)
  await expect(create()).rejects.toThrow("already been deleted")
  expect(rows.size).toBe(0)
})
it("treats a team the user owns in a cell without Free claims as their Free one", async () => {
  missingTable = "billing_account_free_team"
  await create()
  expect(mocks.prepare).toHaveBeenLastCalledWith(
    expect.objectContaining({ additionalTeam: false }),
  )
  rows.set("team_member", [
    { profile_id: user.id, role: "owner", team_id: "elsewhere" },
  ])
  prepared = null
  await create("second", "55555555-5555-4555-8555-555555555555")
  expect(mocks.prepare).toHaveBeenLastCalledWith(
    expect.objectContaining({ additionalTeam: true }),
  )
})

it("marks a team additional when another cell holds the user's Free team", async () => {
  await create()
  expect(mocks.prepare).toHaveBeenLastCalledWith(
    expect.objectContaining({ additionalTeam: false }),
  )
  rows.set("billing_account_free_team", [
    { user_id: user.id, team_id: "elsewhere" },
  ])
  prepared = null
  await create("second", "55555555-5555-4555-8555-555555555555")
  expect(mocks.prepare).toHaveBeenLastCalledWith(
    expect.objectContaining({ additionalTeam: true }),
  )
})

describe("automatic first-team name conflicts", () => {
  const primaryLocator = {
    userId: user.id,
    region: "use",
    operationId: user.id,
  }
  const fallbackLocator = {
    ...primaryLocator,
    operationId: accountTeamFallbackOperationId(user.id),
  }
  const fallbackName = accountTeamFallbackName(user.email!, user.id)
  const fallbackTeamId = "44444444-4444-4444-8444-444444444444"
  const primary: PreparedPromotionTeam = {
    ...primaryLocator,
    teamId,
    attemptId: "backend-attempt",
    createdAt: "2026-11-01T00:00:00Z",
    name: user.email!,
    state: "prepared",
    authorityUnavailable: true,
    additionalTeam: false,
    outcome: null,
    reason: null,
  }
  const fallback: PreparedPromotionTeam = {
    ...primary,
    ...fallbackLocator,
    teamId: fallbackTeamId,
    attemptId: "fallback-attempt",
    name: fallbackName,
  }
  function initial() {
    return provisionTeam("use", user.id, user.email!, user.email!, {
      user,
      observedAt: "2026-11-01T00:00:00Z",
    })
  }

  it.each([
    { authorityUnavailable: false, additionalTeam: false },
    { authorityUnavailable: true, additionalTeam: false },
    { authorityUnavailable: false, additionalTeam: true },
    { authorityUnavailable: true, additionalTeam: true },
  ])(
    "preserves the prepared decision %j when the primary name is taken",
    async (decision) => {
      const primaryAttempt = { ...primary, ...decision }
      const fallbackAttempt = { ...fallback, ...decision }
      mocks.publish.mockResolvedValue({
        authorityUnavailable: !decision.authorityUnavailable,
      })
      mocks.prepare
        .mockResolvedValueOnce(primaryAttempt)
        .mockResolvedValueOnce(fallbackAttempt)
      mocks.complete.mockRejectedValueOnce(
        new PromotionEvidenceError("team_name_conflict"),
      )

      await expect(initial()).resolves.toEqual({
        id: fallbackTeamId,
        name: fallbackName,
        region: "use",
      })
      expect(mocks.recover.mock.calls).toEqual([[primaryLocator]])
      expect(mocks.publish).toHaveBeenCalledTimes(1)
      expect(mocks.prepare).toHaveBeenCalledTimes(2)
      expect(mocks.prepare).toHaveBeenLastCalledWith({
        ...fallbackLocator,
        name: fallbackName,
        ...decision,
      })
      expect(mocks.complete.mock.calls).toEqual([
        [primaryAttempt],
        [fallbackAttempt],
      ])
      expect(rows.get("team_member")).toEqual([
        { team_id: fallbackTeamId, profile_id: user.id, role: "owner" },
      ])
      expect(rows.get("team_memberships")).toEqual([
        {
          id: fallbackTeamId,
          team_id: fallbackTeamId,
          user_id: user.id,
          status: "active",
        },
      ])
      expect(rows.get("user_role_assignments")).toEqual([
        {
          id: fallbackTeamId,
          team_id: fallbackTeamId,
          user_id: user.id,
          role_id: "owner-role",
          scope_type: "team",
        },
      ])
      if (decision.authorityUnavailable) {
        expect(mocks.repairProfile).toHaveBeenCalledTimes(2)
        expect(mocks.repairProfile.mock.invocationCallOrder[0]).toBeLessThan(
          mocks.complete.mock.invocationCallOrder[0],
        )
        expect(mocks.repairProfile.mock.invocationCallOrder[1]).toBeLessThan(
          mocks.complete.mock.invocationCallOrder[1],
        )
      } else {
        expect(mocks.repairProfile).not.toHaveBeenCalled()
      }
    },
  )

  it("recovers an already-stuck primary without publishing again", async () => {
    mocks.recover.mockResolvedValueOnce(primary).mockResolvedValueOnce(null)
    mocks.prepare.mockResolvedValueOnce(fallback)
    mocks.complete.mockRejectedValueOnce(
      new PromotionEvidenceError("team_name_conflict"),
    )

    await expect(initial()).resolves.toEqual({
      id: fallbackTeamId,
      name: fallbackName,
      region: "use",
    })
    expect(mocks.recover.mock.calls).toEqual([
      [primaryLocator],
      [fallbackLocator],
    ])
    expect(mocks.publish).not.toHaveBeenCalled()
    expect(mocks.prepare).toHaveBeenCalledExactlyOnceWith({
      ...fallbackLocator,
      name: fallbackName,
      authorityUnavailable: primary.authorityUnavailable,
      additionalTeam: primary.additionalTeam,
    })
    expect(mocks.complete.mock.calls).toEqual([[primary], [fallback]])
  })

  it.each(["prepared", "completed"] as const)(
    "uses an existing %s fallback without completing the primary",
    async (state) => {
      const recovered = { ...fallback, state }
      mocks.recover
        .mockResolvedValueOnce({ ...primary, authorityUnavailable: false })
        .mockResolvedValueOnce(recovered)

      await expect(initial()).resolves.toEqual({
        id: fallbackTeamId,
        name: fallbackName,
        region: "use",
      })
      expect(mocks.recover.mock.calls).toEqual([
        [primaryLocator],
        [fallbackLocator],
      ])
      expect(mocks.complete).toHaveBeenCalledExactlyOnceWith(recovered)
      expect(mocks.prepare).not.toHaveBeenCalled()
      expect(mocks.publish).not.toHaveBeenCalled()
      expect(mocks.repairProfile.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.complete.mock.invocationCallOrder[0],
      )
    },
  )

  it.each(["completed", "deleted"] as const)(
    "keeps the existing behavior for a %s primary",
    async (state) => {
      const recovered = { ...primary, state }
      mocks.recover.mockResolvedValueOnce(recovered)
      mocks.complete.mockResolvedValueOnce(recovered)

      if (state === "deleted")
        await expect(initial()).rejects.toThrow("already been deleted")
      else
        await expect(initial()).resolves.toMatchObject({
          id: teamId,
          name: user.email,
        })
      expect(mocks.recover).toHaveBeenCalledExactlyOnceWith(primaryLocator)
      expect(mocks.complete).toHaveBeenCalledExactlyOnceWith(recovered)
      expect(mocks.prepare).not.toHaveBeenCalled()
      expect(mocks.publish).not.toHaveBeenCalled()
    },
  )

  it("propagates a fallback name conflict without another attempt", async () => {
    const conflict = new PromotionEvidenceError("team_name_conflict")
    mocks.recover.mockResolvedValueOnce(primary).mockResolvedValueOnce(null)
    mocks.prepare.mockResolvedValueOnce(fallback)
    mocks.complete.mockRejectedValue(conflict)

    await expect(initial()).rejects.toBe(conflict)
    expect(mocks.prepare).toHaveBeenCalledTimes(1)
    expect(mocks.complete.mock.calls).toEqual([[primary], [fallback]])
    expect(rows.size).toBe(0)
  })

  it("propagates an explicit creation name conflict without a fallback", async () => {
    const conflict = new PromotionEvidenceError("team_name_conflict")
    mocks.complete.mockRejectedValueOnce(conflict)

    await expect(create(user.email!, operationId)).rejects.toBe(conflict)
    expect(mocks.recover).toHaveBeenCalledExactlyOnceWith({
      ...primaryLocator,
      operationId,
    })
    expect(mocks.prepare).toHaveBeenCalledExactlyOnceWith({
      ...primaryLocator,
      operationId,
      name: user.email,
      authorityUnavailable: true,
      additionalTeam: false,
    })
    expect(mocks.complete).toHaveBeenCalledTimes(1)
    expect(rows.size).toBe(0)
  })
})
