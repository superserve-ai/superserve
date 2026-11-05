import { beforeEach, describe, expect, it, vi } from "vitest"

const mockPublishPromotionIdentity = vi.fn(async (..._args: unknown[]) => {})
let currentUser: {
  id: string
  email: string
  app_metadata?: { provider?: string; providers?: string[] }
} | null = {
  id: "u1",
  email: "pavitra@superserve.ai",
}

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: currentUser },
      }),
    },
  }),
}))

let googleUser = false
let directoryState = {
  memberships: [] as Array<{ teamId: string; region: string }>,
  degradedRegions: [] as string[],
}
const mockRequireGoogleSignupProof = vi.fn()
const mockConsumeGoogleSignupProof = vi.fn()
const mockEnsureGoogleOnboardingMembership = vi.fn()
const mockReadVerifiedGoogleOnboardingMembership = vi.fn()
const mockClassifyGoogleMembershipState = vi.fn(
  async (
    userId: string,
    directory: {
      memberships: Array<{ teamId: string; region: string }>
      degradedRegions: string[]
    },
  ) => {
    const membership = directory.memberships[0]
    if (membership) {
      return { kind: "existing" as const, membership }
    }
    if (directory.degradedRegions.length > 0) {
      const onboardingMembership =
        await mockReadVerifiedGoogleOnboardingMembership(userId)
      if (onboardingMembership) {
        return { kind: "existing" as const, membership: onboardingMembership }
      }
      return {
        kind: "indeterminate" as const,
        degradedRegions: directory.degradedRegions,
      }
    }
    return { kind: "first_time" as const }
  },
)
const mockIsGoogleUser = vi.fn(
  (_user: { app_metadata?: { provider?: string; providers?: string[] } }) =>
    googleUser,
)
const mockListTeamMembershipsForUserDetailed = vi.fn(
  async (_userId: string, _opts?: { maxAgeMs?: number }) => directoryState,
)
const mockTrackEvent = vi.fn()
const mockEvaluateSignupRestriction = vi.fn()

vi.mock("@/lib/auth/signup-restrictions", () => ({
  SIGNUP_RESTRICTED_MESSAGE: "Signup is not available. Please try again later.",
  SignupRestrictedError: class SignupRestrictedError extends Error {},
  evaluateSignupRestriction: (...args: unknown[]) =>
    mockEvaluateSignupRestriction(...args),
}))

// Per-test knobs read lazily by the cells mock.
let regions: string[] = ["use", "usw"]
let cellClients: Record<string, ReturnType<typeof recordingCellClient>> = {}
let existingRbacAssignment = false
let unfinishedTeamId: string | null = null
// Teams the current user owns through a legacy owner row or an RBAC owner
// assignment, teams with an RBAC membership, and the outcome of a team rename.
let legacyOwnerTeamIds: string[] = []
let rbacOwnerTeamIds: string[] = []
let rbacMemberTeamIds: string[] = []
let renameResult: {
  data: Array<{ id: string }> | null
  error: { code: string; message: string } | null
} = { data: [{ id: "renamed" }], error: null }
let ownerRoleUnavailable = false
// The team's name when a guarded rename matched no row.
let nameAfterRace = "someone-else"

// Records every write per table so tests can assert the full create chain
// landed in one cell and nowhere else.
function recordingCellClient() {
  const writes: Record<string, Array<Record<string, unknown>>> = {}
  const record = (table: string, row: Record<string, unknown>) => {
    writes[table] = [...(writes[table] ?? []), row]
  }
  const from = vi.fn((table: string) => {
    switch (table) {
      case "profile":
        return {
          upsert: async (row: Record<string, unknown>) => {
            record(table, row)
            return { error: null }
          },
        }
      case "team":
        return {
          insert: (row: Record<string, unknown>) => {
            record(table, row)
            return {
              select: () => ({
                single: async () => ({
                  data: { id: "team-new", name: row.name },
                  error: null,
                }),
              }),
            }
          },
          update: (row: Record<string, unknown>) => {
            record(table, row)
            return {
              eq() {
                return this
              },
              select: async () => renameResult,
            }
          },
          select: () => ({
            eq() {
              return this
            },
            limit: async () => ({
              data: [{ name: nameAfterRace }],
              error: null,
            }),
          }),
        }
      case "team_member":
      case "team_memberships":
      case "user_role_assignments":
        return {
          insert: async (row: Record<string, unknown>) => {
            record(table, row)
            return { error: null }
          },
          // A directory entry represents an existing team only when its
          // provisioning RBAC chain was completed.
          select: () => {
            let teamId = ""
            let ownerRole = false
            return {
              eq(column: string, value: string) {
                if (column === "team_id") teamId = value
                if (column === "role_id") ownerRole = true
                return this
              },
              in(column: string, _values: string[]) {
                if (column === "role") ownerRole = true
                return this
              },
              is(_column: string, _value: null) {
                return this
              },
              async limit() {
                if (ownerRole)
                  return {
                    data: (table === "team_member"
                      ? legacyOwnerTeamIds
                      : rbacOwnerTeamIds
                    ).includes(teamId)
                      ? [{ id: "owner", role: "owner" }]
                      : [],
                    error: null,
                  }
                if (table === "team_memberships")
                  return {
                    data: [...rbacMemberTeamIds, ...rbacOwnerTeamIds].includes(
                      teamId,
                    )
                      ? [{ id: teamId }]
                      : [],
                    error: null,
                  }
                return {
                  data:
                    table === "user_role_assignments" &&
                    existingRbacAssignment &&
                    teamId !== unfinishedTeamId
                      ? [{ id: "assignment-old" }]
                      : [],
                  error: null,
                }
              },
            }
          },
        }
      case "roles":
        return {
          select: () => ({
            eq: () => ({
              single: async () =>
                ownerRoleUnavailable
                  ? { data: null, error: { message: "unavailable" } }
                  : { data: { id: "role-owner" }, error: null },
            }),
          }),
        }
      case "billing_account_free_team":
        return {
          select: () => ({
            eq: () => ({ limit: async () => ({ data: [], error: null }) }),
          }),
        }
      default:
        throw new Error(`unexpected table ${table}`)
    }
  })
  return { from, writes }
}

vi.mock("@/lib/api/promotion-identity", () => ({
  publishPromotionIdentity: (...args: unknown[]) =>
    mockPublishPromotionIdentity(...args),
}))
vi.mock("@/lib/cells", () => ({
  DEFAULT_REGION: "use",
  configuredRegions: () => regions,
  cellFor: (region: string) => {
    if (!regions.includes(region)) {
      throw new Error(`Region ${region} is not configured`)
    }
    return {
      region,
      apiBaseUrl: `https://api-${region}.test`,
      createAdminClient: () => cellClients[region],
    }
  },
}))

let directoryTeams: Array<{ id: string; name: string; region: string }> = []
vi.mock("@/lib/api/team-directory", () => ({
  listTeamsForUser: async () => directoryTeams,
  listTeamMembershipsForUserDetailed: (
    ...args: [string, { maxAgeMs?: number }?]
  ) => mockListTeamMembershipsForUserDetailed(...args),
  membershipExistsInCell: async (
    region: string,
    _userId: string,
    teamId: string,
  ) => directoryTeams.some((t) => t.id === teamId && t.region === region),
  invalidateMembershipDirectory: () => {},
}))
vi.mock("@/lib/auth/google-signup-proof", () => ({
  GoogleSignupRecoveryRequiredError: class GoogleSignupRecoveryRequiredError extends Error {},
  consumeGoogleSignupProof: (...args: unknown[]) =>
    mockConsumeGoogleSignupProof(...args),
  readGoogleSignupVisitors: async () => [],
  isGoogleUser: (user: {
    app_metadata?: { provider?: string; providers?: string[] }
  }) => mockIsGoogleUser(user),
  requireGoogleSignupProof: (...args: unknown[]) =>
    mockRequireGoogleSignupProof(...args),
}))
vi.mock("@/lib/auth/google-onboarding", () => ({
  classifyGoogleMembershipState: (
    userId: string,
    directory: {
      memberships: Array<{ teamId: string; region: string }>
      degradedRegions: string[]
    },
  ) => mockClassifyGoogleMembershipState(userId, directory),
  ensureGoogleOnboardingMembership: (...args: unknown[]) =>
    mockEnsureGoogleOnboardingMembership(...args),
}))
vi.mock("@/lib/posthog/actions", () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}))

// Cookie store stub capturing active-team writes.
let cookieValue: string | undefined
const cookieSets: Array<{ name: string; value: string }> = []
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      cookieValue !== undefined ? { name, value: cookieValue } : undefined,
    set: (name: string, value: string) => {
      cookieSets.push({ name, value })
      cookieValue = value
    },
  }),
}))

import {
  SignupRestrictedError,
  SIGNUP_RESTRICTED_MESSAGE,
} from "@/lib/auth/signup-restrictions"

import {
  createTeamAction as createActualTeamAction,
  listTeamsAction,
  setActiveTeamAction,
} from "./teams-actions"

async function createAllowedTeam(name: string, region?: string) {
  const result = await createTeamAction(name, region)
  if ("code" in result) throw new Error(result.message)
  return result
}

function createTeamAction(
  name: string,
  region?: string,
  convertTeamId?: string,
) {
  return createActualTeamAction(
    name,
    region,
    "11111111-1111-4111-8111-111111111111",
    convertTeamId,
  )
}

describe("createTeamAction", () => {
  beforeEach(() => {
    regions = ["use", "usw"]
    directoryTeams = []
    currentUser = { id: "u1", email: "pavitra@superserve.ai" }
    mockPublishPromotionIdentity.mockClear()
    googleUser = false
    existingRbacAssignment = false
    directoryState = { memberships: [], degradedRegions: [] }
    cookieValue = undefined
    cookieSets.length = 0
    mockRequireGoogleSignupProof.mockReset()
    mockConsumeGoogleSignupProof.mockReset()
    mockEnsureGoogleOnboardingMembership
      .mockReset()
      .mockResolvedValue(undefined)
    mockReadVerifiedGoogleOnboardingMembership
      .mockReset()
      .mockResolvedValue(null)
    mockIsGoogleUser.mockReset().mockImplementation(() => googleUser)
    mockListTeamMembershipsForUserDetailed
      .mockReset()
      .mockImplementation(async () => directoryState)
    mockClassifyGoogleMembershipState.mockReset().mockImplementation(
      async (
        userId: string,
        directory: {
          memberships: Array<{ teamId: string; region: string }>
          degradedRegions: string[]
        },
      ) => {
        const membership = directory.memberships[0]
        if (membership) {
          return { kind: "existing" as const, membership }
        }
        if (directory.degradedRegions.length > 0) {
          const onboardingMembership =
            await mockReadVerifiedGoogleOnboardingMembership(userId)
          if (onboardingMembership) {
            return {
              kind: "existing" as const,
              membership: onboardingMembership,
            }
          }
          return {
            kind: "indeterminate" as const,
            degradedRegions: directory.degradedRegions,
          }
        }
        return { kind: "first_time" as const }
      },
    )
    mockTrackEvent.mockReset().mockResolvedValue(undefined)
    mockEvaluateSignupRestriction.mockReset().mockResolvedValue(undefined)
    legacyOwnerTeamIds = []
    rbacOwnerTeamIds = []
    rbacMemberTeamIds = []
    renameResult = { data: [{ id: "team-me" }], error: null }
    nameAfterRace = "someone-else"
    cellClients = {
      use: recordingCellClient(),
      usw: recordingCellClient(),
    }
  })

  it("writes the full RBAC chain into the target cell", async () => {
    const team = await createAllowedTeam("west pilot", "usw")

    expect(team).toEqual({ id: "team-new", name: "west pilot", region: "usw" })

    const writes = cellClients.usw.writes
    expect(mockPublishPromotionIdentity).toHaveBeenCalledWith(
      "usw",
      "u1",
      currentUser,
      expect.any(String),
    )
    expect(writes.team).toBeUndefined()
    expect(writes.team_member).toEqual([
      { team_id: "team-new", profile_id: "u1", role: "owner" },
    ])
    expect(writes.team_memberships).toEqual([
      { id: "team-new", team_id: "team-new", user_id: "u1", status: "active" },
    ])
    expect(writes.user_role_assignments).toEqual([
      {
        id: "team-new",
        user_id: "u1",
        role_id: "role-owner",
        scope_type: "team",
        team_id: "team-new",
      },
    ])
    expect(mockEnsureGoogleOnboardingMembership).not.toHaveBeenCalled()

    // Nothing leaked into the default cell.
    // The other cell is only read for the user's Free claim.
    expect(cellClients.use.from.mock.calls).toEqual([
      ["billing_account_free_team"],
    ])

    // The creator lands in the new team.
    expect(cookieSets).toEqual([
      { name: "ss-active-team", value: "usw:team-new" },
    ])
  })

  it("defaults to the default region when none is given", async () => {
    const team = await createAllowedTeam("east team")

    expect(team.region).toBe("use")
    expect(cellClients.use.writes.team).toBeUndefined()
    // The other cell is only read for the user's Free claim.
    expect(cellClients.usw.from.mock.calls).toEqual([
      ["billing_account_free_team"],
    ])
  })

  it("returns a serializable denial without selecting a team", async () => {
    mockEvaluateSignupRestriction.mockRejectedValueOnce(
      new SignupRestrictedError(),
    )

    await expect(createTeamAction("blocked", "usw")).resolves.toEqual({
      code: "signup_blocked",
      message: SIGNUP_RESTRICTED_MESSAGE,
    })
    expect(cellClients.usw.writes.team).toBeUndefined()
    expect(cookieSets).toEqual([])
  })

  it("rejects a region that is not configured", async () => {
    regions = ["use"]
    await expect(createTeamAction("west pilot", "usw")).rejects.toThrow(
      "Region usw is not available",
    )
  })

  it("rejects an empty team name", async () => {
    await expect(createTeamAction("   ")).rejects.toThrow(
      "Team name is required",
    )
  })

  it("requires the Google signup proof for a first-team Google user", async () => {
    currentUser = {
      id: "u1",
      email: "pavitra@superserve.ai",
      app_metadata: { provider: "google", providers: ["google"] },
    }
    googleUser = true
    mockRequireGoogleSignupProof.mockResolvedValue(undefined)

    await createTeamAction("west pilot", "usw")

    expect(mockIsGoogleUser).toHaveBeenCalled()
    expect(mockListTeamMembershipsForUserDetailed).toHaveBeenCalledWith("u1", {
      maxAgeMs: 0,
    })
    expect(mockRequireGoogleSignupProof).toHaveBeenCalledTimes(1)
    expect(mockConsumeGoogleSignupProof).toHaveBeenCalledWith("u1")
  })

  it("blocks a first-time Google user without proof", async () => {
    currentUser = {
      id: "u1",
      email: "pavitra@superserve.ai",
      app_metadata: { provider: "google", providers: ["google"] },
    }
    googleUser = true
    mockRequireGoogleSignupProof.mockRejectedValue(
      new Error("Google signup verification required"),
    )

    await expect(createTeamAction("west pilot", "usw")).rejects.toThrow(
      "Google signup verification required",
    )

    expect(mockConsumeGoogleSignupProof).not.toHaveBeenCalled()
    expect(cellClients.usw.writes).toEqual({})
  })

  it("lets an existing Google user create an additional team without a fresh proof", async () => {
    currentUser = {
      id: "u1",
      email: "pavitra@superserve.ai",
      app_metadata: { provider: "google", providers: ["google"] },
    }
    googleUser = true
    directoryState = {
      memberships: [{ teamId: "team-old", region: "use" }],
      degradedRegions: [],
    }
    existingRbacAssignment = true

    const team = await createAllowedTeam("west pilot", "usw")

    expect(team).toEqual({ id: "team-new", name: "west pilot", region: "usw" })
    expect(mockRequireGoogleSignupProof).not.toHaveBeenCalled()
    expect(cellClients.usw.writes.team).toBeUndefined()
  })

  it("fails transiently when a degraded empty lookup cannot be recovered", async () => {
    currentUser = {
      id: "u1",
      email: "pavitra@superserve.ai",
      app_metadata: { provider: "google", providers: ["google"] },
    }
    googleUser = true
    directoryState = { memberships: [], degradedRegions: ["usw"] }

    await expect(createTeamAction("west pilot", "usw")).rejects.toThrow(
      "Google membership lookup degraded; please try again",
    )

    expect(mockRequireGoogleSignupProof).not.toHaveBeenCalled()
    expect(cellClients.usw.writes.team).toBeUndefined()
  })

  describe("from the user's own account", () => {
    // First login provisions the account's team, named after the email.
    beforeEach(() => {
      directoryTeams = [
        { id: "team-me", name: "pavitra@superserve.ai", region: "use" },
      ]
      directoryState = {
        memberships: [{ teamId: "team-me", region: "use" }],
        degradedRegions: [],
      }
      existingRbacAssignment = true
      legacyOwnerTeamIds = ["team-me"]
      cookieValue = "use:team-me"
    })

    it("converts the account in place instead of creating a team", async () => {
      const team = await convertAccount("acme")

      expect(team).toEqual({ id: "team-me", name: "acme", region: "use" })
      expect(cellClients.use.writes).toEqual({
        team: [{ name: "acme", updated_at: expect.any(String) }],
      })
      expect(cellClients.usw.writes).toEqual({})
      expect(mockPublishPromotionIdentity).not.toHaveBeenCalled()
      expect(cookieSets).toEqual([
        { name: "ss-active-team", value: "use:team-me" },
      ])
    })

    it("matches the account name without regard to case", async () => {
      directoryTeams = [
        { id: "team-me", name: "Pavitra@Superserve.ai", region: "use" },
      ]

      expect(await convertAccount("acme")).toMatchObject({ id: "team-me" })
    })

    it("converts an account owned through an RBAC owner assignment", async () => {
      legacyOwnerTeamIds = []
      rbacOwnerTeamIds = ["team-me"]

      expect(await convertAccount("acme")).toMatchObject({
        id: "team-me",
        name: "acme",
      })
    })

    it("refuses an owner whose RBAC owner grant was revoked", async () => {
      rbacMemberTeamIds = ["team-me"]

      expectUnavailable(await createTeamAction("acme", "use", "team-me"))
    })

    it("refuses a member who does not own the account", async () => {
      legacyOwnerTeamIds = []

      expectUnavailable(await createTeamAction("acme", "use", "team-me"))
    })

    it("refuses a team that is not in the user's directory", async () => {
      expectUnavailable(await createTeamAction("acme", "use", "team-other"))
    })

    it("refuses a region other than the account's", async () => {
      expectUnavailable(await createTeamAction("acme", "usw", "team-me"))
      expect(cellClients.usw.writes).toEqual({})
    })

    it("refuses a stale form after the account was renamed", async () => {
      directoryTeams = [{ id: "team-me", name: "alpha", region: "use" }]

      expectUnavailable(await createTeamAction("beta", "use", "team-me"))
    })

    it("refuses when the account is renamed concurrently", async () => {
      renameResult = { data: [], error: null }

      const result = await createTeamAction("acme", "use", "team-me")

      expect(result).toMatchObject({ code: "team_conversion_unavailable" })
      expect(cookieSets).toEqual([])
    })

    it("accepts a concurrent conversion to the same name", async () => {
      renameResult = { data: [], error: null }
      nameAfterRace = "acme"

      expect(await convertAccount("acme")).toEqual({
        id: "team-me",
        name: "acme",
        region: "use",
      })
      expect(cookieSets).toEqual([
        { name: "ss-active-team", value: "use:team-me" },
      ])
    })

    it("rejects a name longer than 256 bytes before renaming", async () => {
      await expect(
        createTeamAction("é".repeat(129), "use", "team-me"),
      ).rejects.toThrow("between 1 and 256 bytes")
      expect(cellClients.use.writes).toEqual({})
    })

    it("returns the converted account when a retry finds it renamed", async () => {
      directoryTeams = [{ id: "team-me", name: "acme", region: "use" }]

      const team = await convertAccount("acme")

      expect(team).toEqual({ id: "team-me", name: "acme", region: "use" })
      expect(cellClients.use.writes).toEqual({})
    })

    it("reports a taken name without changing the selection", async () => {
      renameResult = {
        data: null,
        error: { code: "23505", message: "duplicate key" },
      }

      expect(await createTeamAction("acme", "use", "team-me")).toEqual({
        code: "team_name_conflict",
        message: expect.stringContaining("already taken"),
      })
      expect(cookieSets).toEqual([])
    })

    it("creates a new team when the form does not ask for a conversion", async () => {
      const team = await createAllowedTeam("acme", "use")

      expect(team.id).toBe("team-new")
      // The account keeps its name: the new team is not a rename.
      expect(cellClients.use.writes.team).toBeUndefined()
    })

    it("creates a new team named like the converted account when asked", async () => {
      directoryTeams = [{ id: "team-me", name: "acme", region: "use" }]

      const team = await createAllowedTeam("acme", "use")

      expect(team.id).toBe("team-new")
    })
  })
})

async function convertAccount(name: string) {
  const result = await createTeamAction(name, "use", "team-me")
  if ("code" in result) throw new Error(result.message)
  return result
}

// A refused conversion never falls back to a new team.
function expectUnavailable(
  result: Awaited<ReturnType<typeof createTeamAction>>,
) {
  expect(result).toEqual({
    code: "team_conversion_unavailable",
    message: expect.stringContaining("can no longer be converted"),
  })
  expect(cellClients.use.writes).toEqual({})
  expect(cellClients.usw.writes).toEqual({})
  expect(mockPublishPromotionIdentity).not.toHaveBeenCalled()
  expect(cookieSets).toEqual([])
}

describe("active team", () => {
  beforeEach(() => {
    regions = ["use", "usw"]
    existingRbacAssignment = true
    unfinishedTeamId = null
    legacyOwnerTeamIds = []
    rbacOwnerTeamIds = []
    rbacMemberTeamIds = []
    ownerRoleUnavailable = false
    cellClients = { use: recordingCellClient(), usw: recordingCellClient() }
    cookieValue = undefined
    cookieSets.length = 0
    directoryTeams = [
      { id: "team-a", name: "alpha", region: "use" },
      { id: "team-w", name: "west", region: "usw" },
    ]
  })

  it("directory marks the cookie's team active", async () => {
    cookieValue = "usw:team-w"
    const { activeTeamId, activeRegion } = await listTeamsAction()
    expect(activeTeamId).toBe("team-w")
    expect(activeRegion).toBe("usw")
  })

  it("directory offers to convert the user's own account", async () => {
    currentUser = { id: "u1", email: "pavitra@superserve.ai" }
    directoryTeams = [
      { id: "team-me", name: "pavitra@superserve.ai", region: "use" },
      { id: "team-w", name: "west", region: "usw" },
    ]
    cookieValue = "use:team-me"

    legacyOwnerTeamIds = ["team-me"]
    expect((await listTeamsAction()).convertibleTeams).toEqual([
      { id: "team-me", name: "pavitra@superserve.ai", region: "use" },
    ])

    // Only the owner can convert the account.
    legacyOwnerTeamIds = []
    expect((await listTeamsAction()).convertibleTeams).toEqual([])

    // A revoked RBAC owner grant leaves the legacy owner row in place.
    legacyOwnerTeamIds = ["team-me"]
    rbacMemberTeamIds = ["team-me"]
    expect((await listTeamsAction()).convertibleTeams).toEqual([])
    rbacMemberTeamIds = []

    // The offer does not depend on the active team, so a cached directory
    // still converts after the user switches to the account.
    legacyOwnerTeamIds = ["team-me", "team-w"]
    cookieValue = "usw:team-w"
    expect(await listTeamsAction()).toMatchObject({
      activeTeamId: "team-w",
      convertibleTeams: [{ id: "team-me" }],
    })
  })

  it("directory offers every account team the user owns", async () => {
    currentUser = { id: "u1", email: "pavitra@superserve.ai" }
    directoryTeams = [
      { id: "team-me", name: "pavitra@superserve.ai", region: "use" },
      { id: "team-mw", name: "pavitra@superserve.ai", region: "usw" },
    ]
    cookieValue = "use:team-me"
    legacyOwnerTeamIds = ["team-me", "team-mw"]

    expect((await listTeamsAction()).convertibleTeams).toEqual(directoryTeams)
  })

  it("directory serves without a conversion when the owner lookup fails", async () => {
    currentUser = { id: "u1", email: "pavitra@superserve.ai" }
    directoryTeams = [
      { id: "team-me", name: "pavitra@superserve.ai", region: "use" },
    ]
    rbacMemberTeamIds = ["team-me"]
    ownerRoleUnavailable = true
    const error = vi.spyOn(console, "error").mockImplementation(() => {})

    expect(await listTeamsAction()).toMatchObject({
      activeTeamId: "team-me",
      convertibleTeams: [],
    })
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })

  it("directory falls back to the first team without a cookie", async () => {
    const { activeTeamId, activeRegion } = await listTeamsAction()
    expect(activeTeamId).toBe("team-a")
    expect(activeRegion).toBe("use")
  })

  it("setActiveTeamAction stores a verified membership", async () => {
    await setActiveTeamAction("team-w", "usw")
    expect(cookieSets).toEqual([
      { name: "ss-active-team", value: "usw:team-w" },
    ])
  })

  it("setActiveTeamAction rejects a team the user is not in", async () => {
    await expect(setActiveTeamAction("intruder", "usw")).rejects.toThrow(
      "not a member",
    )
    expect(cookieSets).toEqual([])
  })

  it("hides an orphaned membership and rejects selecting it", async () => {
    directoryTeams = [
      { id: "team-a", name: "orphan", region: "use" },
      { id: "team-b", name: "completed", region: "use" },
    ]
    unfinishedTeamId = "team-a"
    cookieValue = "use:team-a"

    expect(await listTeamsAction()).toMatchObject({
      teams: [{ id: "team-b" }],
      activeTeamId: "team-b",
      activeRegion: "use",
    })
    await expect(setActiveTeamAction("team-a", "use")).rejects.toThrow(
      "not a member",
    )
    expect(cookieSets).toEqual([])

    cookieValue = undefined
    expect((await listTeamsAction()).activeTeamId).toBe("team-b")
  })
})

vi.mock("@/lib/api/promotion-publication", () => ({
  publishAccountPromotion: async (
    region: string,
    user: { id: string },
    observedAt: string,
  ) => {
    try {
      await mockPublishPromotionIdentity(region, user.id, user, observedAt)
      return { authorityUnavailable: false }
    } catch {
      return { authorityUnavailable: true }
    }
  },
}))
vi.mock("@/lib/api/promotion-device-evidence", () => ({
  PromotionEvidenceError: class extends Error {},
  recoverPromotionTeam: async () => null,
  preparePromotionTeam: async (input: object) => ({
    ...input,
    teamId: "team-new",
    attemptId: "backend-attempt",
    state: "prepared",
  }),
  completePromotionTeam: async (input: object) => ({
    ...input,
    state: "completed",
  }),
}))
