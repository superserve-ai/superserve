import type { User } from "@supabase/supabase-js"
import { beforeEach, expect, it, vi } from "vitest"

import {
  PromotionEvidenceError,
  type PreparedPromotionTeam,
  type PromotionTeamPreparation,
} from "./promotion-device-evidence"
import {
  replacementTeamName,
  replacementTeamOperationId,
} from "./replacement-team"

const mocks = vi.hoisted(() => ({
  randomUUID: vi.fn(),
  publish: vi.fn(),
  recover: vi.fn(),
  prepare: vi.fn(),
  complete: vi.fn(),
  recoverEnterprise: vi.fn(),
  completeEnterprise: vi.fn(),
}))
vi.mock("node:crypto", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:crypto")>()
  return {
    ...original,
    default: { ...original, randomUUID: mocks.randomUUID },
    randomUUID: mocks.randomUUID,
  }
})
vi.mock("./promotion-publication", () => ({
  publishAccountPromotion: mocks.publish,
}))
vi.mock("./promotion-device-evidence", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./promotion-device-evidence")>()),
  recoverPromotionTeam: mocks.recover,
  preparePromotionTeam: mocks.prepare,
  completePromotionTeam: mocks.complete,
  recoverPromotionTeamForEnterprise: mocks.recoverEnterprise,
  completePromotionTeamForEnterprise: mocks.completeEnterprise,
}))
vi.mock("./team-directory", () => ({
  listTeamMembershipsForUserDetailed: async () => ({
    memberships: [],
    degradedRegions: [],
  }),
}))
vi.mock("@/lib/admin/enterprise-provisioning-authority", () => ({
  authorizeEnterpriseProvisioning: async () => ({}),
  enterpriseProvisioningContext: () => ({ user }),
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

import { provisionHeldApplicantTeam, provisionTeam } from "./team-provisioning"

const user = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "user@example.com",
} as User
const originalTeamId = "22222222-2222-4222-8222-222222222222"
const explicitOperationId = "33333333-3333-4333-8333-333333333333"
const replacementTeamId = "44444444-4444-4444-8444-444444444444"
const thirdTeamId = "55555555-5555-4555-8555-555555555555"
const observedAt = "2026-11-17T00:00:00Z"
type Row = Record<string, unknown>
const rows = new Map<string, Row[]>()
const creations = new Map<string, PreparedPromotionTeam>()
const writes: { table: string; row: Row }[] = []
let membershipReadErrorTeamId: string | undefined

function from(table: string) {
  const filters: [string, unknown][] = []
  const read = () => {
    if (
      table === "team_memberships" &&
      filters.some(
        ([key, value]) =>
          key === "team_id" && value === membershipReadErrorTeamId,
      )
    )
      return { data: null, error: { message: "membership read failed" } }
    return {
      data: (rows.get(table) ?? []).filter((row) =>
        filters.every(([key, value]) => (row[key] ?? null) === value),
      ),
      error: null,
    }
  }
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
    // Supabase queries are awaitable without a terminal modifier.
    // oxlint-disable-next-line unicorn/no-thenable
    then: (resolve: (result: ReturnType<typeof read>) => unknown) =>
      Promise.resolve(read()).then(resolve),
    limit: async (count: number) => {
      const result = read()
      return { ...result, data: result.data?.slice(0, count) ?? null }
    },
    single: async () => ({ data: { id: "owner-role" }, error: null }),
    upsert: async (input: Row) => {
      writes.push({ table, row: { ...input } })
      return { error: null }
    },
    insert: async (input: Row) => {
      writes.push({ table, row: { ...input } })
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

function create(operationId?: string) {
  return provisionTeam(
    "use",
    user.id,
    user.email!,
    user.email!,
    { user, observedAt },
    operationId,
  )
}

function seedCreation(
  teamId = originalTeamId,
  operationId = user.id,
  state: PreparedPromotionTeam["state"] = "completed",
) {
  const creation: PreparedPromotionTeam = {
    userId: user.id,
    operationId,
    region: "use",
    teamId,
    attemptId: teamId,
    name: user.email!,
    authorityUnavailable: false,
    createdAt: observedAt,
    state,
    outcome: "promotion_ineligible",
    reason: "no_evidence",
  }
  creations.set(operationId, creation)
  return creation
}

function seedRemovedTeam(teamId = originalTeamId) {
  rows.set("team_member", [
    ...(rows.get("team_member") ?? []),
    { team_id: teamId, profile_id: user.id, role: "owner" },
  ])
  rows.set("team_memberships", [
    ...(rows.get("team_memberships") ?? []),
    { id: teamId, team_id: teamId, user_id: user.id, status: "inactive" },
    {
      id: `other-${teamId}`,
      team_id: teamId,
      user_id: "other",
      status: "active",
    },
  ])
  rows.set("user_role_assignments", [
    ...(rows.get("user_role_assignments") ?? []),
    {
      id: teamId,
      team_id: teamId,
      user_id: user.id,
      role_id: "owner-role",
      scope_type: "team",
      revoked_at: observedAt,
    },
  ])
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.randomUUID.mockReturnValue("abcdef12-3456-4789-abcd-0123456789ab")
  rows.clear()
  creations.clear()
  writes.length = 0
  membershipReadErrorTeamId = undefined
  mocks.publish.mockResolvedValue({ authorityUnavailable: false })
  mocks.recover.mockImplementation(
    async ({ operationId }: { operationId: string }) =>
      creations.get(operationId) ?? null,
  )
  mocks.prepare.mockImplementation(async (input: PromotionTeamPreparation) => {
    const existing = creations.get(input.operationId)
    if (existing) {
      if (
        existing.userId !== input.userId ||
        existing.name !== input.name ||
        existing.region !== input.region ||
        existing.authorityUnavailable !== input.authorityUnavailable ||
        !!existing.additionalTeam !== !!input.additionalTeam
      )
        throw new PromotionEvidenceError("creation_conflict", 409)
      return existing
    }
    const teamId =
      mocks.prepare.mock.calls.length === 1 ? replacementTeamId : thirdTeamId
    const prepared: PreparedPromotionTeam = {
      ...input,
      teamId,
      attemptId: teamId,
      createdAt: observedAt,
      state: "prepared",
      outcome: null,
      reason: null,
    }
    creations.set(input.operationId, prepared)
    return prepared
  })
  mocks.complete.mockImplementation(async (input: PreparedPromotionTeam) => {
    const completed: PreparedPromotionTeam = {
      ...input,
      state: input.state === "deleted" ? "deleted" : "completed",
    }
    creations.set(input.operationId, completed)
    return completed
  })
})

it("replaces a removed owner's automatic team and leaves the old team's rows untouched", async () => {
  seedCreation()
  seedRemovedTeam()
  const originalRows = structuredClone([...rows])
  const operationId = replacementTeamOperationId(user.id, originalTeamId)
  const team = await create()
  const { name } = team

  expect(team).toEqual({
    id: replacementTeamId,
    name: expect.stringMatching(/^user@example\.com \([0-9a-f]{8}\)$/),
    region: "use",
  })
  expect(name).not.toBe(replacementTeamName(user.email!, operationId))

  expect(mocks.recover.mock.calls).toEqual([
    [{ userId: user.id, region: "use", operationId: user.id }],
    [{ userId: user.id, region: "use", operationId }],
  ])
  expect(mocks.prepare).toHaveBeenCalledExactlyOnceWith({
    userId: user.id,
    region: "use",
    operationId,
    name,
    authorityUnavailable: false,
    additionalTeam: false,
  })
  expect(mocks.publish).toHaveBeenCalledExactlyOnceWith("use", user, observedAt)
  expect(mocks.complete).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      operationId,
      teamId: replacementTeamId,
      state: "prepared",
    }),
  )
  expect(writes).toEqual([
    {
      table: "team_member",
      row: { team_id: replacementTeamId, profile_id: user.id, role: "owner" },
    },
    {
      table: "team_memberships",
      row: {
        id: replacementTeamId,
        team_id: replacementTeamId,
        user_id: user.id,
        status: "active",
      },
    },
    {
      table: "user_role_assignments",
      row: {
        id: replacementTeamId,
        user_id: user.id,
        role_id: "owner-role",
        scope_type: "team",
        team_id: replacementTeamId,
      },
    },
  ])
  for (const [table, previous] of originalRows) {
    expect(
      rows.get(table)?.filter((row) => row.team_id === originalTeamId),
    ).toEqual(previous)
    expect(rows.get(table)).toContainEqual(
      expect.objectContaining({ team_id: replacementTeamId }),
    )
  }
})

it("recovers the same replacement on retry without preparing or publishing again", async () => {
  seedCreation()
  seedRemovedTeam()
  mocks.complete.mockRejectedValueOnce(new Error("completion interrupted"))
  await expect(create()).rejects.toThrow("completion interrupted")
  const operationId = replacementTeamOperationId(user.id, originalTeamId)
  const prepared = creations.get(operationId)!
  mocks.randomUUID.mockReturnValue("fedcba98-7654-4321-abcd-0123456789ab")

  const team = await create()
  expect(team.name).toBe(prepared.name)
  expect(mocks.complete).toHaveBeenLastCalledWith(prepared)
  const previousRows = structuredClone([...rows])

  await expect(create()).resolves.toEqual(team)

  expect(mocks.prepare).toHaveBeenCalledTimes(1)
  expect(mocks.publish).toHaveBeenCalledTimes(1)
  expect([...rows]).toEqual(previousRows)
  expect(mocks.complete).toHaveBeenLastCalledWith(
    expect.objectContaining({
      teamId: replacementTeamId,
      name: prepared.name,
      state: "completed",
    }),
  )
})

it("concurrent replacements use the first prepared name and create only one team", async () => {
  seedCreation()
  seedRemovedTeam()
  const originalRows = structuredClone([...rows])
  const operationId = replacementTeamOperationId(user.id, originalTeamId)
  mocks.randomUUID
    .mockReturnValueOnce("abcdef12-3456-4789-abcd-0123456789ab")
    .mockReturnValueOnce("fedcba98-7654-4321-abcd-0123456789ab")
  let initialRecoveries = 0
  let releaseRecoveries!: () => void
  const bothRecovered = new Promise<void>((resolve) => {
    releaseRecoveries = resolve
  })
  mocks.recover.mockImplementation(async (locator: { operationId: string }) => {
    const existing = creations.get(locator.operationId) ?? null
    if (locator.operationId === operationId && !existing) {
      initialRecoveries += 1
      if (initialRecoveries === 2) releaseRecoveries()
      await bothRecovered
    }
    return existing
  })

  const teams = await Promise.all([create(), create()])
  const prepared = creations.get(operationId)!

  expect(initialRecoveries).toBe(2)
  expect(mocks.prepare).toHaveBeenCalledTimes(2)
  expect(mocks.prepare.mock.calls.map(([input]) => input.name)).toEqual([
    replacementTeamName(user.email!, "abcdef12"),
    replacementTeamName(user.email!, "fedcba98"),
  ])
  expect(mocks.recover).toHaveBeenLastCalledWith({
    userId: user.id,
    region: "use",
    operationId,
  })
  expect(teams).toEqual([
    { id: replacementTeamId, name: prepared.name, region: "use" },
    { id: replacementTeamId, name: prepared.name, region: "use" },
  ])
  expect(prepared.name).toBe(mocks.prepare.mock.calls[0][0].name)
  expect(creations.size).toBe(2)
  expect(mocks.complete).toHaveBeenCalledTimes(2)
  for (const [table, previous] of originalRows) {
    expect(
      rows.get(table)?.filter((row) => row.team_id === originalTeamId),
    ).toEqual(previous)
    expect(
      rows.get(table)?.filter((row) => row.team_id !== originalTeamId),
    ).toEqual([expect.objectContaining({ team_id: replacementTeamId })])
  }
})

it.each([
  new PromotionEvidenceError("creation_conflict", 409),
  new PromotionEvidenceError("team_name_conflict", 409),
  new Error("preparation failed"),
])(
  "preserves replacement preparation errors without a stored creation: %s",
  async (error) => {
    seedCreation()
    seedRemovedTeam()
    mocks.prepare.mockRejectedValue(error)

    await expect(create()).rejects.toBe(error)

    expect(mocks.recover).toHaveBeenCalledTimes(
      error instanceof PromotionEvidenceError &&
        error.code === "creation_conflict"
        ? 3
        : 2,
    )
    expect(mocks.complete).not.toHaveBeenCalled()
    expect(writes).toEqual([])
  },
)

it.each([undefined, explicitOperationId])(
  "does not recover preparation conflicts for the original locator %s",
  async (operationId) => {
    const error = new PromotionEvidenceError("creation_conflict", 409)
    mocks.prepare.mockRejectedValue(error)

    await expect(create(operationId)).rejects.toBe(error)

    expect(mocks.recover).toHaveBeenCalledExactlyOnceWith({
      userId: user.id,
      region: "use",
      operationId: operationId ?? user.id,
    })
    expect(mocks.complete).not.toHaveBeenCalled()
    expect(writes).toEqual([])
  },
)

it("follows the chain when the user is later removed from the replacement", async () => {
  seedCreation()
  seedRemovedTeam()
  await create()
  rows
    .get("team_memberships")!
    .find((row) => row.id === replacementTeamId)!.status = "inactive"
  rows
    .get("user_role_assignments")!
    .find((row) => row.id === replacementTeamId)!.revoked_at = observedAt
  const previousRows = structuredClone([...rows])
  const operationId = replacementTeamOperationId(user.id, replacementTeamId)
  mocks.randomUUID.mockReturnValue("fedcba98-7654-4321-abcd-0123456789ab")
  const team = await create()
  const { name } = team

  expect(team).toEqual({
    id: thirdTeamId,
    name: expect.stringMatching(/^user@example\.com \([0-9a-f]{8}\)$/),
    region: "use",
  })
  expect(name).not.toBe(replacementTeamName(user.email!, operationId))

  expect(mocks.prepare).toHaveBeenCalledTimes(2)
  expect(mocks.prepare).toHaveBeenLastCalledWith(
    expect.objectContaining({ operationId, name }),
  )
  expect(mocks.publish).toHaveBeenCalledTimes(2)
  for (const [table, previous] of previousRows) {
    expect(
      rows.get(table)?.filter((row) => row.team_id !== thirdTeamId),
    ).toEqual(previous)
  }
})

it("keeps the user id locator and given name for a new user's initial creation", async () => {
  await expect(create()).resolves.toEqual({
    id: replacementTeamId,
    name: user.email,
    region: "use",
  })

  expect(mocks.prepare).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ operationId: user.id, name: user.email }),
  )
  expect(mocks.recover).toHaveBeenCalledTimes(1)
})

it.each([
  "active",
  "missing",
  "inactive and active",
  "invited and active",
  "inactive and invited and active",
])("finishes the original creation with %s membership rows", async (status) => {
  seedCreation()
  if (status !== "missing") {
    rows.set("team_memberships", [
      {
        id: originalTeamId,
        team_id: originalTeamId,
        user_id: user.id,
        status: "active",
      },
      ...(status.includes("inactive")
        ? [
            {
              id: "old-membership",
              team_id: originalTeamId,
              user_id: user.id,
              status: "inactive",
            },
          ]
        : []),
      ...(status.includes("invited")
        ? [
            {
              id: "invited-membership",
              team_id: originalTeamId,
              user_id: user.id,
              status: "invited",
            },
          ]
        : []),
    ])
  }

  await expect(create()).resolves.toEqual({
    id: originalTeamId,
    name: user.email,
    region: "use",
  })

  expect(mocks.recover).toHaveBeenCalledTimes(1)
  expect(mocks.prepare).not.toHaveBeenCalled()
  expect(mocks.publish).not.toHaveBeenCalled()
  expect(rows.get("team_memberships")).toContainEqual({
    id: originalTeamId,
    team_id: originalTeamId,
    user_id: user.id,
    status: "active",
  })
})

it.each(["invited", "inactive and invited"])(
  "replaces an automatic team with %s membership rows",
  async (scenario) => {
    seedCreation()
    seedRemovedTeam()
    const memberships = rows.get("team_memberships")!
    memberships[0].status = "invited"
    if (scenario === "inactive and invited")
      memberships.push({
        id: "old-membership",
        team_id: originalTeamId,
        user_id: user.id,
        status: "inactive",
      })
    const previousRows = structuredClone([...rows])

    await expect(create()).resolves.toEqual({
      id: replacementTeamId,
      name: replacementTeamName(user.email!, "abcdef12"),
      region: "use",
    })

    expect(mocks.prepare).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        operationId: replacementTeamOperationId(user.id, originalTeamId),
      }),
    )
    for (const [table, previous] of previousRows) {
      expect(
        rows.get(table)?.filter((row) => row.team_id === originalTeamId),
      ).toEqual(previous)
    }
    expect(writes.every(({ row }) => row.team_id === replacementTeamId)).toBe(
      true,
    )
  },
)

it("keeps the existing membership error for an explicit creation", async () => {
  seedCreation(originalTeamId, explicitOperationId)
  seedRemovedTeam()
  const previousRows = structuredClone([...rows])

  await expect(create(explicitOperationId)).rejects.toThrow(
    "Unable to verify existing active membership",
  )

  expect(mocks.recover).toHaveBeenCalledTimes(1)
  expect(mocks.prepare).not.toHaveBeenCalled()
  expect(mocks.publish).not.toHaveBeenCalled()
  expect([...rows]).toEqual(previousRows)
})

it.each(["original", "replacement"])(
  "fails closed when the %s membership read fails",
  async (scenario) => {
    seedCreation()
    seedRemovedTeam()
    membershipReadErrorTeamId = originalTeamId
    if (scenario === "replacement") {
      seedCreation(
        replacementTeamId,
        replacementTeamOperationId(user.id, originalTeamId),
      )
      seedRemovedTeam(replacementTeamId)
      membershipReadErrorTeamId = replacementTeamId
    }
    const previousRows = structuredClone([...rows])

    await expect(create()).rejects.toThrow("membership read failed")

    expect(mocks.prepare).not.toHaveBeenCalled()
    expect(mocks.publish).not.toHaveBeenCalled()
    expect(mocks.complete).not.toHaveBeenCalled()
    expect(writes).toEqual([])
    expect([...rows]).toEqual(previousRows)
  },
)

it.each(["prepared", "deleted"] as const)(
  "does not replace a %s creation with inactive membership",
  async (state) => {
    seedCreation(originalTeamId, user.id, state)
    seedRemovedTeam()

    await expect(create()).rejects.toThrow(
      state === "deleted"
        ? "already been deleted"
        : "Unable to verify existing active membership",
    )

    expect(mocks.recover).toHaveBeenCalledTimes(1)
    expect(mocks.prepare).not.toHaveBeenCalled()
    expect(mocks.publish).not.toHaveBeenCalled()
  },
)

it("keeps the Enterprise held-applicant path on its original creation", async () => {
  const prepared = seedCreation()
  seedRemovedTeam()
  mocks.recoverEnterprise.mockResolvedValue(prepared)
  mocks.completeEnterprise.mockResolvedValue(prepared)
  const applicant = { ...user, app_metadata: { signup_review: "pending" } }

  await expect(
    provisionHeldApplicantTeam(applicant, "use", "enterprise-plan"),
  ).rejects.toThrow("Unable to verify existing active membership")

  expect(mocks.recoverEnterprise).toHaveBeenCalledTimes(1)
  expect(mocks.recover).not.toHaveBeenCalled()
  expect(mocks.prepare).not.toHaveBeenCalled()
  expect(mocks.publish).not.toHaveBeenCalled()
})

it("bounds a chain of removed teams without preparing or writing anything", async () => {
  let operationId = user.id
  for (let index = 0; index <= 10; index++) {
    const teamId = `removed-team-${index}`
    seedCreation(teamId, operationId)
    seedRemovedTeam(teamId)
    operationId = replacementTeamOperationId(user.id, teamId)
  }

  await expect(create()).rejects.toThrow(
    "Removed team replacement chain exceeds 10 hops",
  )

  expect(mocks.recover).toHaveBeenCalledTimes(11)
  expect(mocks.prepare).not.toHaveBeenCalled()
  expect(mocks.publish).not.toHaveBeenCalled()
  expect(mocks.complete).not.toHaveBeenCalled()
  expect(writes).toEqual([])
})
