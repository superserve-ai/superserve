import type { User } from "@supabase/supabase-js"
import { beforeEach, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({
  publish: vi.fn(),
  recover: vi.fn(),
  prepare: vi.fn(),
  complete: vi.fn(),
}))
vi.mock("./promotion-publication", () => ({
  publishAccountPromotion: mocks.publish,
}))
vi.mock("./promotion-device-evidence", () => ({
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
    limit: async () => ({
      data: (rows.get(table) ?? []).filter((row) =>
        filters.every(([key, value]) => (row[key] ?? null) === value),
      ),
      error: null,
    }),
    single: async () => ({ data: { id: "owner-role" }, error: null }),
    upsert: async () => ({ error: null }),
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
  vi.resetAllMocks()
  rows.clear()
  failTable = undefined
  prepared = null
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
