import { beforeEach, describe, expect, it, vi } from "vitest"

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
          select: () => ({
            eq(_column: string, _value: string) {
              return this
            },
            is(_column: string, _value: null) {
              return this
            },
            async limit() {
              return {
                data:
                  table === "user_role_assignments" && existingRbacAssignment
                    ? [{ id: "assignment-old" }]
                    : [],
                error: null,
              }
            },
          }),
        }
      case "roles":
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: { id: "role-owner" },
                error: null,
              }),
            }),
          }),
        }
      default:
        throw new Error(`unexpected table ${table}`)
    }
  })
  return { from, writes }
}

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
  createTeamAction,
  listTeamsAction,
  setActiveTeamAction,
} from "./teams-actions"

async function createAllowedTeam(name: string, region?: string) {
  const result = await createTeamAction(name, region)
  if ("code" in result) throw new Error(result.message)
  return result
}

describe("createTeamAction", () => {
  beforeEach(() => {
    regions = ["use", "usw"]
    directoryTeams = []
    currentUser = { id: "u1", email: "pavitra@superserve.ai" }
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
    cellClients = {
      use: recordingCellClient(),
      usw: recordingCellClient(),
    }
  })

  it("writes the full RBAC chain into the target cell", async () => {
    const team = await createAllowedTeam("west pilot", "usw")

    expect(team).toEqual({ id: "team-new", name: "west pilot", region: "usw" })

    const writes = cellClients.usw.writes
    expect(writes.profile).toEqual([
      { id: "u1", email: "pavitra@superserve.ai" },
    ])
    expect(writes.team).toEqual([{ name: "west pilot", home_region: "usw" }])
    expect(writes.team_member).toEqual([
      { team_id: "team-new", profile_id: "u1", role: "owner" },
    ])
    expect(writes.team_memberships).toEqual([
      { team_id: "team-new", user_id: "u1", status: "active" },
    ])
    expect(writes.user_role_assignments).toEqual([
      {
        user_id: "u1",
        role_id: "role-owner",
        scope_type: "team",
        team_id: "team-new",
      },
    ])
    expect(mockEnsureGoogleOnboardingMembership).not.toHaveBeenCalled()

    // Nothing leaked into the default cell.
    expect(cellClients.use.from).not.toHaveBeenCalled()

    // The creator lands in the new team.
    expect(cookieSets).toEqual([
      { name: "ss-active-team", value: "usw:team-new" },
    ])
  })

  it("defaults to the default region when none is given", async () => {
    const team = await createAllowedTeam("east team")

    expect(team.region).toBe("use")
    expect(cellClients.use.writes.team).toEqual([
      { name: "east team", home_region: "use" },
    ])
    expect(cellClients.usw.from).not.toHaveBeenCalled()
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
    expect(cellClients.usw.writes.team).toEqual([
      { name: "west pilot", home_region: "usw" },
    ])
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
})

describe("active team", () => {
  beforeEach(() => {
    regions = ["use", "usw"]
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
})
