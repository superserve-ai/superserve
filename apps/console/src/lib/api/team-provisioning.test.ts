/**
 * team-provisioning — the single correct way to create a team.
 *
 * The control plane authorizes through the RBAC chain (team_memberships +
 * user_role_assignments), so a team is only usable if the whole chain landed.
 * These tests pin two things:
 *  - the happy path writes every row into the target cell, and
 *  - a mid-chain failure unwinds in reverse dependency order, so a half-
 *    written team the console lists but the control plane rejects can't linger.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

import { pickActiveTeam } from "@/lib/api/active-team"

let clients: Record<string, ReturnType<typeof recordingClient>> = {}
let currentUser: {
  id: string
  email: string
  app_metadata?: { provider?: string; providers?: string[] }
  user_metadata?: { signup_attempt_id?: string }
} | null = null
let googleUser = false
let directoryState = {
  memberships: [] as Array<{ teamId: string; region: string }>,
  degradedRegions: [] as string[],
}
let completionState: Record<
  string,
  {
    assignment: boolean
    revoked?: boolean
    rbac: boolean
    joinedAt?: string
    role?: string
    ownerPresent?: boolean
    rbacOwnerPresent?: boolean
  }
> = {}
let memberInsertGate: Promise<void> | null = null
let completionLookupGate: Promise<void> | null = null
let completionLookups: string[] = []
const mockTrackEvent = vi.fn()
const mockReadSignupEvidence = vi.fn()
const mockClearSignupEvidence = vi.fn()
const mockEvaluateSignupRestriction = vi.fn()
const evidenceJar = new Map<string, string>()
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      evidenceJar.has(name) ? { value: evidenceJar.get(name)! } : undefined,
    getAll: () => [...evidenceJar].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string, options?: { maxAge?: number }) => {
      if (options?.maxAge === 0) evidenceJar.delete(name)
      else evidenceJar.set(name, value)
    },
  }),
}))
vi.mock("@/lib/auth/signup-evidence", () => ({
  readSignupEvidence: (...args: unknown[]) => mockReadSignupEvidence(...args),
  readSignupEvidenceEntries: async (...args: unknown[]) => {
    const value = await mockReadSignupEvidence(...args)
    return (Array.isArray(value) ? value : value ? [value] : []).map(
      (visitor: string, index: number) => ({
        attempt: `attempt-${index + 1}`,
        visitor,
        value: `signed-${index + 1}`,
      }),
    )
  },
  clearEvaluatedSignupEvidence: (actor: string, entries: unknown[]) =>
    mockClearSignupEvidence(actor, entries),
  clearSignupEvidence: (...args: unknown[]) => mockClearSignupEvidence(...args),
}))
vi.mock("@/lib/auth/signup-restrictions", () => ({
  evaluateSignupRestriction: (...args: unknown[]) =>
    mockEvaluateSignupRestriction(...args),
}))
const mockConsumeGoogleSignupProof = vi.fn()
const mockRequireGoogleSignupProof = vi.fn()
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

// Records writes and deletes per table, and can be told to fail one table's
// insert so the unwind path is exercised.
function recordingClient(
  failTable?: string,
  failDeleteTable?: string | string[],
  failCompletionTable?: string,
) {
  const writes: Record<string, Array<Record<string, unknown>>> = {}
  const deletes: string[] = []
  const record = (table: string, row: Record<string, unknown>) => {
    writes[table] = [...(writes[table] ?? []), row]
  }
  const result = (table: string) =>
    failTable === table
      ? { error: { message: `boom ${table}` } }
      : { error: null }

  const from = (table: string) => ({
    upsert: async (row: Record<string, unknown>) => {
      record(table, row)
      return result(table)
    },
    insert: (row: Record<string, unknown>) => {
      record(table, row)
      if (table === "team") {
        return {
          select: () => ({
            single: async () => ({
              data: { id: "team-new", name: row.name },
              error: result(table).error,
            }),
          }),
        }
      }
      if (table === "team_member" && memberInsertGate)
        return memberInsertGate.then(() => result(table))
      return Promise.resolve(result(table))
    },
    select: () => {
      let teamId = ""
      let requireUnrevoked = false
      let ownerLookup = false
      let ownerAssignmentLookup = false
      const query = {
        eq(column: string, value: string) {
          if (column === "team_id") teamId = value
          if (column === "role" && value === "owner") ownerLookup = true
          if (column === "role_id" && value === "role-owner")
            ownerAssignmentLookup = true
          return this
        },
        is(column: string, value: null) {
          if (column === "revoked_at" && value === null) requireUnrevoked = true
          return this
        },
        limit: async () => {
          if (table === "user_role_assignments" && !ownerAssignmentLookup) {
            completionLookups.push(teamId)
            if (completionLookupGate) await completionLookupGate
          }
          if (table === failCompletionTable)
            return { data: null, error: { message: `boom ${table}` } }
          const state = completionState[teamId] ?? {
            assignment: true,
            rbac: true,
          }
          const data =
            table === "user_role_assignments"
              ? (ownerAssignmentLookup
                  ? state.rbacOwnerPresent
                  : state.assignment) && !(requireUnrevoked && state.revoked)
                ? [{ id: "assignment" }]
                : []
              : table === "roles"
                ? [{ id: "role-owner" }]
                : table === "team_memberships"
                  ? state.rbac
                    ? [{ id: "membership" }]
                    : []
                  : table === "team_member"
                    ? ownerLookup
                      ? state.ownerPresent
                        ? [{ profile_id: "another-owner" }]
                        : []
                      : state.joinedAt
                        ? [{ joined_at: state.joinedAt, role: state.role }]
                        : []
                    : []
          return { data, error: null }
        },
        single: async () => ({ data: { id: "role-owner" }, error: null }),
      }
      return query
    },
    delete: () => ({
      eq: async () => {
        deletes.push(table)
        return {
          error: (
            Array.isArray(failDeleteTable)
              ? failDeleteTable.includes(table)
              : table === failDeleteTable
          )
            ? { message: `failed cleanup ${table}` }
            : null,
        }
      },
    }),
  })
  return { from, writes, deletes }
}

vi.mock("@/lib/cells", () => ({
  DEFAULT_REGION: "use",
  cellFor: (region: string) => ({
    region,
    createAdminClient: () => clients[region],
  }),
}))
vi.mock("@/lib/posthog/actions", () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}))
vi.mock("@/lib/posthog/events", () => ({
  AUTH_EVENTS: {
    GOOGLE_SIGNUP_BYPASS_BLOCKED: "auth_google_signup_bypass_blocked",
    GOOGLE_SIGNUP_PROOF_CONSUMED: "auth_google_signup_proof_consumed",
  },
}))
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: currentUser } })) },
  })),
}))
vi.mock("@/lib/api/team-directory", () => ({
  listTeamMembershipsForUserDetailed: (
    ...args: [string, { maxAgeMs?: number }?]
  ) => mockListTeamMembershipsForUserDetailed(...args),
}))
vi.mock("@/lib/auth/google-signup-proof", () => ({
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
  readVerifiedGoogleOnboardingMembership: (...args: unknown[]) =>
    mockReadVerifiedGoogleOnboardingMembership(...args),
}))

import { completedMemberships, provisionTeam } from "./team-provisioning"

describe("provisionTeam", () => {
  beforeEach(() => {
    evidenceJar.clear()
    clients = { use: recordingClient(), usw: recordingClient() }
    currentUser = {
      id: "u1",
      email: "user@example.com",
      user_metadata: { signup_attempt_id: "attempt-1" },
    }
    googleUser = false
    directoryState = { memberships: [], degradedRegions: [] }
    completionState = {}
    memberInsertGate = null
    completionLookupGate = null
    completionLookups = []
    mockTrackEvent.mockReset().mockResolvedValue(undefined)
    mockReadSignupEvidence.mockReset().mockResolvedValue(null)
    mockClearSignupEvidence.mockReset().mockResolvedValue(undefined)
    mockEvaluateSignupRestriction.mockReset().mockResolvedValue(undefined)
    mockConsumeGoogleSignupProof.mockReset()
    mockRequireGoogleSignupProof.mockReset()
    mockEnsureGoogleOnboardingMembership
      .mockReset()
      .mockResolvedValue(undefined)
    mockReadVerifiedGoogleOnboardingMembership
      .mockReset()
      .mockResolvedValue(null)
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
    mockListTeamMembershipsForUserDetailed
      .mockReset()
      .mockImplementation(async () => directoryState)
  })

  it("checks current policy on every first-team retry before any value write", async () => {
    mockReadSignupEvidence.mockResolvedValue("VisitorCase")
    mockEvaluateSignupRestriction
      .mockRejectedValueOnce(
        new Error("Signup is not available. Please try again later."),
      )
      .mockResolvedValueOnce(undefined)

    await expect(
      provisionTeam("use", "u1", "user@example.com", "team"),
    ).rejects.toThrow("Signup is not available")
    expect(clients.use.writes).toEqual({})
    expect(mockClearSignupEvidence).not.toHaveBeenCalled()

    await provisionTeam("use", "u1", "user@example.com", "team")
    expect(mockReadSignupEvidence).toHaveBeenCalledTimes(2)
    expect(mockEvaluateSignupRestriction).toHaveBeenNthCalledWith(
      2,
      "use",
      "u1",
      "VisitorCase",
    )
    expect(mockClearSignupEvidence).toHaveBeenCalledTimes(1)
  })

  it("blocks first-time Google provisioning with evidence from the active attempt", async () => {
    currentUser = {
      id: "u1",
      email: "user@example.com",
      app_metadata: { provider: "google", providers: ["google"] },
    }
    googleUser = true
    mockRequireGoogleSignupProof.mockResolvedValue("attempt-1")
    mockReadSignupEvidence.mockResolvedValue("VisitorCase")
    mockEvaluateSignupRestriction.mockRejectedValue(
      new Error("Signup is not available. Please try again later."),
    )

    await expect(
      provisionTeam("use", "u1", "user@example.com", "team"),
    ).rejects.toThrow("Signup is not available")

    expect(mockRequireGoogleSignupProof).toHaveBeenCalledTimes(1)
    expect(mockReadSignupEvidence).toHaveBeenCalledExactlyOnceWith("u1")
    expect(mockEvaluateSignupRestriction).toHaveBeenCalledTimes(1)
    expect(mockEvaluateSignupRestriction).toHaveBeenCalledWith(
      "use",
      "u1",
      "VisitorCase",
    )
    expect(clients.use.writes).toEqual({})
    expect(mockConsumeGoogleSignupProof).not.toHaveBeenCalled()
    expect(mockClearSignupEvidence).not.toHaveBeenCalled()
  })

  it.each([undefined, {}, { signup_attempt_id: "changed-attempt" }])(
    "uses actor-bound signed email evidence despite editable metadata %j",
    async (metadata) => {
      currentUser = {
        id: "u1",
        email: "user@example.com",
        user_metadata: metadata,
      }
      mockReadSignupEvidence.mockImplementation(
        async (actor: string, attempt?: string) =>
          actor === "u1" && attempt === undefined ? "Restricted" : null,
      )
      mockEvaluateSignupRestriction.mockRejectedValue(
        new Error("Signup is not available. Please try again later."),
      )

      await expect(
        provisionTeam("use", "u1", "user@example.com", "team"),
      ).rejects.toThrow("Signup is not available")

      expect(mockReadSignupEvidence).toHaveBeenCalledExactlyOnceWith("u1")
      expect(mockEvaluateSignupRestriction).toHaveBeenCalledWith(
        "use",
        "u1",
        "Restricted",
      )
      expect(clients.use.writes).toEqual({})
      expect(mockClearSignupEvidence).not.toHaveBeenCalled()
    },
  )

  it("evaluates active evidence with a legacy Google proof without an attempt ID", async () => {
    currentUser = {
      id: "u1",
      email: "user@example.com",
      app_metadata: { provider: "google", providers: ["google"] },
    }
    googleUser = true
    mockRequireGoogleSignupProof.mockResolvedValue(undefined)
    mockReadSignupEvidence.mockResolvedValue("VisitorFromNewAttempt")
    mockEvaluateSignupRestriction.mockRejectedValue(
      new Error("Signup is not available. Please try again later."),
    )

    await expect(
      provisionTeam("use", "u1", "user@example.com", "team"),
    ).rejects.toThrow("Signup is not available")

    expect(mockReadSignupEvidence).toHaveBeenCalledExactlyOnceWith("u1")
    expect(mockEvaluateSignupRestriction).toHaveBeenCalledWith(
      "use",
      "u1",
      "VisitorFromNewAttempt",
    )
    expect(clients.use.writes).toEqual({})
    expect(mockConsumeGoogleSignupProof).not.toHaveBeenCalled()
    expect(mockClearSignupEvidence).not.toHaveBeenCalled()
  })

  it.each(["attempt-1", undefined])(
    "evaluates active evidence despite Google selector %j choosing an older proof",
    async (selector) => {
      currentUser = {
        id: "u1",
        email: "user@example.com",
        app_metadata: { provider: "google", providers: ["google"] },
      }
      googleUser = true
      const previousSecret = process.env.GOOGLE_SIGNUP_PROOF_SECRET
      process.env.GOOGLE_SIGNUP_PROOF_SECRET =
        "test-signing-secret-at-least-32-bytes-long"
      try {
        const proof = await vi.importActual<
          typeof import("@/lib/auth/google-signup-proof")
        >("@/lib/auth/google-signup-proof")
        const evidence = await vi.importActual<
          typeof import("@/lib/auth/signup-evidence")
        >("@/lib/auth/signup-evidence")
        await proof.issueGoogleSignupProof("attempt-1")
        await proof.markGoogleSignupAttempt("attempt-1", "u1")
        await proof.issueGoogleSignupProof("attempt-2")
        await proof.markGoogleSignupAttempt("attempt-2", "u1")
        await evidence.beginSignupEvidenceAttempt("attempt-2")
        await evidence.saveSignupEvidence(
          "u1",
          "attempt-2",
          "event-2",
          "RestrictedVisitorFromAttemptTwo",
        )

        const pendingCookie = "__Host-superserve-google-signup-attempt"
        if (selector) evidenceJar.set(pendingCookie, selector)
        else evidenceJar.delete(pendingCookie)
        mockRequireGoogleSignupProof.mockImplementation(
          proof.requireGoogleSignupProof,
        )
        mockReadSignupEvidence.mockImplementation(
          (actor: string, attempt?: string) =>
            evidence.readSignupEvidence(actor, attempt),
        )
        mockEvaluateSignupRestriction.mockRejectedValue(
          new Error("Signup is not available. Please try again later."),
        )

        expect(await proof.requireGoogleSignupProof("u1", "attempt-2")).toBe(
          "attempt-2",
        )
        expect(await proof.requireGoogleSignupProof("u1")).toBe("attempt-1")
        expect(await evidence.readSignupEvidence("u1", "attempt-1")).toBeNull()
        expect(await evidence.readSignupEvidence("another-user")).toBeNull()

        await expect(
          provisionTeam("use", "u1", "user@example.com", "team"),
        ).rejects.toThrow("Signup is not available")

        expect(mockRequireGoogleSignupProof).toHaveBeenCalledTimes(1)
        expect(mockReadSignupEvidence).toHaveBeenCalledExactlyOnceWith("u1")
        expect(mockEvaluateSignupRestriction).toHaveBeenCalledWith(
          "use",
          "u1",
          "RestrictedVisitorFromAttemptTwo",
        )
        expect(clients.use.writes).toEqual({})
        expect(mockClearSignupEvidence).not.toHaveBeenCalled()
        expect(mockConsumeGoogleSignupProof).not.toHaveBeenCalled()
      } finally {
        if (previousSecret === undefined)
          delete process.env.GOOGLE_SIGNUP_PROOF_SECRET
        else process.env.GOOGLE_SIGNUP_PROOF_SECRET = previousSecret
      }
    },
  )

  it("does not evaluate established accounts or infer first signup from a degraded directory", async () => {
    directoryState = {
      memberships: [{ teamId: "old", region: "use" }],
      degradedRegions: [],
    }
    await provisionTeam("usw", "u1", "user@example.com", "extra")
    expect(mockEvaluateSignupRestriction).not.toHaveBeenCalled()

    directoryState = { memberships: [], degradedRegions: ["usw"] }
    await expect(
      provisionTeam("use", "u1", "user@example.com", "team"),
    ).rejects.toThrow("Membership lookup degraded")
    expect(mockEvaluateSignupRestriction).not.toHaveBeenCalled()
  })

  it("keeps the selected east membership when west completion fails", async () => {
    clients.usw = recordingClient(undefined, undefined, "user_role_assignments")
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      const directory = await completedMemberships("u1", {
        memberships: [
          { teamId: "team-east", region: "use" },
          { teamId: "team-west", region: "usw" },
        ],
        degradedRegions: [],
      })

      expect(directory).toEqual({
        memberships: [{ teamId: "team-east", region: "use" }],
        degradedRegions: ["usw"],
      })
      expect(
        pickActiveTeam(directory.memberships, {
          teamId: "team-east",
          region: "use",
        }),
      ).toEqual({ teamId: "team-east", region: "use" })
      expect(errorSpy).toHaveBeenCalledOnce()
    } finally {
      errorSpy.mockRestore()
    }
  })

  it("starts completion checks for every membership before waiting for one", async () => {
    let release!: () => void
    completionLookupGate = new Promise<void>((resolve) => {
      release = resolve
    })
    const result = completedMemberships("u1", {
      memberships: [
        { teamId: "team-east", region: "use" },
        { teamId: "team-east-2", region: "use" },
        { teamId: "team-west", region: "usw" },
      ],
      degradedRegions: [],
    })
    try {
      expect(completionLookups).toEqual([
        "team-east",
        "team-east-2",
        "team-west",
      ])
    } finally {
      release()
    }
    expect(await result).toEqual({
      memberships: [
        { teamId: "team-east", region: "use" },
        { teamId: "team-east-2", region: "use" },
        { teamId: "team-west", region: "usw" },
      ],
      degradedRegions: [],
    })
  })

  it("does not classify a failed west completion as a first team", async () => {
    clients.usw = recordingClient(undefined, undefined, "user_role_assignments")
    directoryState = {
      memberships: [{ teamId: "team-west", region: "usw" }],
      degradedRegions: [],
    }
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      await expect(
        provisionTeam("use", "u1", "user@example.com", "retry"),
      ).rejects.toThrow("Membership lookup degraded")
      expect(mockEvaluateSignupRestriction).not.toHaveBeenCalled()
      expect(clients.use.writes).toEqual({})
    } finally {
      errorSpy.mockRestore()
    }
  })

  it("writes the full RBAC chain into the target cell", async () => {
    const team = await provisionTeam(
      "usw",
      "u1",
      "user@example.com",
      "west pilot",
    )

    expect(team).toEqual({ id: "team-new", name: "west pilot", region: "usw" })

    const { writes } = clients.usw
    expect(writes.profile).toEqual([{ id: "u1", email: "user@example.com" }])
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

    // Nothing touched a cell other than the target.
    expect(clients.use.writes).toEqual({})
  })

  it("unwinds in reverse dependency order when a chain write fails", async () => {
    clients = { use: recordingClient("team_memberships") }

    await expect(
      provisionTeam("use", "u1", "user@example.com", "east team"),
    ).rejects.toThrow(/boom team_memberships.*\(team team-new\)/)

    // Reverse dependency order so nothing is deleted before its dependents.
    expect(clients.use.deletes).toEqual([
      "user_role_assignments",
      "team_memberships",
      "team_member",
      "team",
    ])
    expect(mockConsumeGoogleSignupProof).not.toHaveBeenCalled()
  })

  it("retains evidence after a provisioning-chain failure and evaluates it on retry", async () => {
    clients = { use: recordingClient("team_memberships") }
    mockReadSignupEvidence.mockResolvedValue("VisitorCase")
    mockEvaluateSignupRestriction
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(
        new Error("Signup is not available. Please try again later."),
      )

    await expect(
      provisionTeam("use", "u1", "user@example.com", "east team"),
    ).rejects.toThrow(/boom team_memberships/)
    expect(mockClearSignupEvidence).not.toHaveBeenCalled()

    clients = { use: recordingClient() }
    await expect(
      provisionTeam("use", "u1", "user@example.com", "east team"),
    ).rejects.toThrow("Signup is not available")

    expect(mockReadSignupEvidence).toHaveBeenCalledTimes(2)
    expect(mockEvaluateSignupRestriction).toHaveBeenNthCalledWith(
      2,
      "use",
      "u1",
      "VisitorCase",
    )
    expect(clients.use.writes).toEqual({})
    expect(mockClearSignupEvidence).not.toHaveBeenCalled()
  })

  it("does not exempt a retry when failed cleanup leaves a partial legacy row", async () => {
    clients = { use: recordingClient("team_memberships", "team_member") }
    mockReadSignupEvidence.mockResolvedValue("Restricted")
    mockEvaluateSignupRestriction
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Signup is not available"))

    await expect(
      provisionTeam("use", "u1", "user@example.com", "first"),
    ).rejects.toThrow("boom team_memberships")
    directoryState = {
      memberships: [{ teamId: "team-new", region: "use" }],
      degradedRegions: [],
    }
    completionState["team-new"] = {
      assignment: false,
      rbac: false,
      joinedAt: "2026-09-24T00:00:00Z",
      role: "owner",
    }
    clients = { use: recordingClient() }

    await expect(
      provisionTeam("use", "u1", "user@example.com", "retry"),
    ).rejects.toThrow("Signup is not available")
    expect(mockEvaluateSignupRestriction).toHaveBeenCalledTimes(2)
    expect(clients.use.writes).toEqual({})
    expect(mockClearSignupEvidence).not.toHaveBeenCalled()
  })

  it("does not exempt an orphaned RBAC membership after partial cleanup", async () => {
    clients = {
      use: recordingClient("user_role_assignments", [
        "team_memberships",
        "team",
      ]),
    }
    mockReadSignupEvidence.mockResolvedValue("Restricted")
    mockEvaluateSignupRestriction
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Signup is not available"))
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      await expect(
        provisionTeam("use", "u1", "user@example.com", "first"),
      ).rejects.toThrow("boom user_role_assignments")
      expect(clients.use.deletes).toEqual([
        "user_role_assignments",
        "team_memberships",
        "team_member",
        "team",
      ])
      directoryState = {
        memberships: [{ teamId: "team-new", region: "use" }],
        degradedRegions: [],
      }
      completionState["team-new"] = {
        assignment: false,
        rbac: true,
      }
      clients = { use: recordingClient() }

      await expect(
        provisionTeam("use", "u1", "user@example.com", "retry"),
      ).rejects.toThrow("Signup is not available")
      expect(mockEvaluateSignupRestriction).toHaveBeenCalledTimes(2)
      expect(clients.use.writes).toEqual({})
      expect(mockClearSignupEvidence).not.toHaveBeenCalled()
    } finally {
      errorSpy.mockRestore()
    }
  })

  it("evaluates an overlapping attempt while the first membership is unfinished", async () => {
    let releaseMember!: () => void
    memberInsertGate = new Promise<void>((resolve) => {
      releaseMember = resolve
    })
    mockReadSignupEvidence.mockResolvedValue("Restricted")
    mockEvaluateSignupRestriction
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Signup is not available"))
    const first = provisionTeam("use", "u1", "user@example.com", "first")
    try {
      await vi.waitFor(() =>
        expect(clients.use.writes.team_member).toHaveLength(1),
      )
      directoryState = {
        memberships: [{ teamId: "team-new", region: "use" }],
        degradedRegions: [],
      }
      completionState["team-new"] = {
        assignment: false,
        rbac: false,
        joinedAt: "2026-09-24T00:00:00Z",
        role: "owner",
      }
      await expect(
        provisionTeam("use", "u1", "user@example.com", "overlap"),
      ).rejects.toThrow("Signup is not available")
      expect(clients.use.writes.team).toHaveLength(1)
    } finally {
      releaseMember()
      await first
    }
  })

  it("keeps a pre-RBAC legacy membership exempt", async () => {
    directoryState = {
      memberships: [{ teamId: "legacy", region: "use" }],
      degradedRegions: [],
    }
    completionState.legacy = {
      assignment: false,
      rbac: false,
      joinedAt: "2026-07-01T00:00:00Z",
    }

    await provisionTeam("use", "u1", "user@example.com", "extra")
    expect(mockEvaluateSignupRestriction).not.toHaveBeenCalled()
  })

  it.each([false, true])(
    "keeps a legacy owner created before the RBAC production deployment exempt for Google=%s",
    async (isGoogle) => {
      googleUser = isGoogle
      if (isGoogle)
        currentUser = {
          id: "u1",
          email: "user@example.com",
          app_metadata: { provider: "google", providers: ["google"] },
        }
      directoryState = {
        memberships: [{ teamId: "legacy", region: "use" }],
        degradedRegions: [],
      }
      completionState.legacy = {
        assignment: false,
        rbac: false,
        joinedAt: "2026-07-09T22:45:00Z",
        role: "owner",
      }
      mockReadSignupEvidence.mockResolvedValue("Restricted")
      mockEvaluateSignupRestriction.mockRejectedValue(new Error("blocked"))

      await provisionTeam("use", "u1", "user@example.com", "extra")

      expect(mockEvaluateSignupRestriction).not.toHaveBeenCalled()
      expect(mockRequireGoogleSignupProof).not.toHaveBeenCalled()
      expect(clients.use.writes.team).toHaveLength(1)
    },
  )

  it("keeps a Google account established after its last role is revoked", async () => {
    currentUser = {
      id: "u1",
      email: "user@example.com",
      app_metadata: { provider: "google", providers: ["google"] },
    }
    googleUser = true
    directoryState = {
      memberships: [{ teamId: "established", region: "use" }],
      degradedRegions: [],
    }
    completionState.established = {
      assignment: true,
      revoked: true,
      rbac: true,
    }
    mockReadSignupEvidence.mockResolvedValue("Restricted")
    mockEvaluateSignupRestriction.mockRejectedValue(new Error("blocked"))

    await provisionTeam("use", "u1", "user@example.com", "extra")

    expect(mockRequireGoogleSignupProof).not.toHaveBeenCalled()
    expect(mockEvaluateSignupRestriction).not.toHaveBeenCalled()
    expect(clients.use.writes.team).toHaveLength(1)
  })

  it("allows an active joined Google member without a role to create another team", async () => {
    currentUser = {
      id: "u1",
      email: "user@example.com",
      app_metadata: { provider: "google", providers: ["google"] },
    }
    googleUser = true
    directoryState = {
      memberships: [{ teamId: "joined", region: "use" }],
      degradedRegions: [],
    }
    completionState.joined = {
      assignment: false,
      rbac: true,
      ownerPresent: true,
    }
    mockReadSignupEvidence.mockResolvedValue("Restricted")
    mockEvaluateSignupRestriction.mockRejectedValue(new Error("blocked"))

    await provisionTeam("use", "u1", "user@example.com", "extra")

    expect(mockRequireGoogleSignupProof).not.toHaveBeenCalled()
    expect(mockEvaluateSignupRestriction).not.toHaveBeenCalled()
    expect(clients.use.writes.team).toHaveLength(1)
  })

  it.each([false, true])(
    "recognizes an RBAC-only roleless join with an RBAC owner for Google=%s",
    async (isGoogle) => {
      googleUser = isGoogle
      if (isGoogle)
        currentUser = {
          id: "u1",
          email: "user@example.com",
          app_metadata: { provider: "google", providers: ["google"] },
        }
      directoryState = {
        memberships: [{ teamId: "joined", region: "use" }],
        degradedRegions: [],
      }
      completionState.joined = {
        assignment: false,
        rbac: true,
        rbacOwnerPresent: true,
      }
      mockReadSignupEvidence.mockResolvedValue("Restricted")
      mockEvaluateSignupRestriction.mockRejectedValue(new Error("blocked"))

      await provisionTeam("use", "u1", "user@example.com", "extra")

      expect(mockRequireGoogleSignupProof).not.toHaveBeenCalled()
      expect(mockEvaluateSignupRestriction).not.toHaveBeenCalled()
      expect(clients.use.writes.team).toHaveLength(1)
    },
  )

  it("recognizes an RBAC-only join whose owner was migrated from a non-owner legacy role", async () => {
    directoryState = {
      memberships: [{ teamId: "migrated", region: "use" }],
      degradedRegions: [],
    }
    completionState.migrated = {
      assignment: false,
      rbac: true,
      rbacOwnerPresent: true,
    }
    mockEvaluateSignupRestriction.mockRejectedValue(new Error("blocked"))

    await provisionTeam("use", "u1", "user@example.com", "extra")

    expect(mockEvaluateSignupRestriction).not.toHaveBeenCalled()
    expect(clients.use.writes.team).toHaveLength(1)
  })

  it("does not treat a revoked RBAC owner assignment as completion", async () => {
    directoryState = {
      memberships: [{ teamId: "orphan", region: "use" }],
      degradedRegions: [],
    }
    completionState.orphan = {
      assignment: false,
      rbac: true,
      rbacOwnerPresent: true,
      revoked: true,
    }
    mockReadSignupEvidence.mockResolvedValue("Restricted")
    mockEvaluateSignupRestriction.mockRejectedValue(new Error("blocked"))

    await expect(
      provisionTeam("use", "u1", "user@example.com", "first"),
    ).rejects.toThrow("blocked")
    expect(clients.use.writes).toEqual({})
  })

  it("requires Google proof and evaluates evidence after a partial RBAC write", async () => {
    currentUser = {
      id: "u1",
      email: "user@example.com",
      app_metadata: { provider: "google", providers: ["google"] },
    }
    googleUser = true
    directoryState = {
      memberships: [{ teamId: "partial", region: "use" }],
      degradedRegions: [],
    }
    completionState.partial = {
      assignment: false,
      rbac: true,
      joinedAt: "2026-09-24T00:00:00Z",
      role: "owner",
    }
    mockRequireGoogleSignupProof.mockResolvedValue("attempt-2")
    mockReadSignupEvidence.mockResolvedValue("Restricted")
    mockEvaluateSignupRestriction.mockRejectedValue(
      new Error("Signup is not available"),
    )

    await expect(
      provisionTeam("use", "u1", "user@example.com", "retry"),
    ).rejects.toThrow("Signup is not available")
    expect(mockRequireGoogleSignupProof).toHaveBeenCalledTimes(1)
    expect(mockEvaluateSignupRestriction).toHaveBeenCalledWith(
      "use",
      "u1",
      "Restricted",
    )
    expect(clients.use.writes).toEqual({})
  })

  it("requires Google proof for partial RBAC provisioning even when policy allows", async () => {
    currentUser = {
      id: "u1",
      email: "user@example.com",
      app_metadata: { provider: "google", providers: ["google"] },
    }
    googleUser = true
    directoryState = {
      memberships: [{ teamId: "partial", region: "use" }],
      degradedRegions: [],
    }
    completionState.partial = {
      assignment: false,
      rbac: true,
      joinedAt: "2026-09-24T00:00:00Z",
      role: "owner",
    }
    mockRequireGoogleSignupProof.mockRejectedValue(
      new Error("Google signup proof required"),
    )

    await expect(
      provisionTeam("use", "u1", "user@example.com", "retry"),
    ).rejects.toThrow("Google signup proof required")
    expect(mockEvaluateSignupRestriction).not.toHaveBeenCalled()
    expect(clients.use.writes).toEqual({})
  })

  it("does not consume the Google proof when a first-time Google provisioning chain fails", async () => {
    clients = { use: recordingClient("team_memberships") }
    currentUser = {
      id: "u1",
      email: "user@example.com",
      app_metadata: { provider: "google", providers: ["google"] },
    }
    googleUser = true
    directoryState = { memberships: [], degradedRegions: [] }
    mockRequireGoogleSignupProof.mockResolvedValue(undefined)

    await expect(
      provisionTeam("use", "u1", "user@example.com", "east team"),
    ).rejects.toThrow(/boom team_memberships.*\(team team-new\)/)

    expect(mockRequireGoogleSignupProof).toHaveBeenCalledTimes(1)
    expect(mockConsumeGoogleSignupProof).not.toHaveBeenCalled()
    expect(mockEnsureGoogleOnboardingMembership).not.toHaveBeenCalled()
  })

  it("requires a proof for a first-time Google user and consumes it after success", async () => {
    currentUser = {
      id: "u1",
      email: "user@example.com",
      app_metadata: { provider: "google", providers: ["google"] },
    }
    googleUser = true
    directoryState = { memberships: [], degradedRegions: [] }
    mockRequireGoogleSignupProof.mockResolvedValue(undefined)

    await provisionTeam("usw", "u1", "user@example.com", "west pilot")

    expect(mockRequireGoogleSignupProof).toHaveBeenCalledTimes(1)
    expect(mockConsumeGoogleSignupProof).toHaveBeenCalledWith("u1")
  })

  it("records a bypass block when a first-time Google user lacks proof", async () => {
    currentUser = {
      id: "u1",
      email: "user@example.com",
      app_metadata: { provider: "google", providers: ["google"] },
    }
    googleUser = true
    directoryState = { memberships: [], degradedRegions: [] }
    mockRequireGoogleSignupProof.mockRejectedValue(
      new Error("Google signup verification required"),
    )

    await expect(
      provisionTeam("usw", "u1", "user@example.com", "west pilot"),
    ).rejects.toThrow("Google signup verification required")

    expect(mockConsumeGoogleSignupProof).not.toHaveBeenCalled()
    expect(clients.use.writes).toEqual({})
  })

  it("does not block an established Google user when the deeper lookup was degraded", async () => {
    currentUser = {
      id: "u1",
      email: "user@example.com",
      app_metadata: { provider: "google", providers: ["google"] },
    }
    googleUser = true
    directoryState = {
      memberships: [{ teamId: "team-old", region: "use" }],
      degradedRegions: ["usw"],
    }

    await expect(
      provisionTeam("usw", "u1", "user@example.com", "west pilot"),
    ).resolves.toEqual({ id: "team-new", name: "west pilot", region: "usw" })
    expect(mockRequireGoogleSignupProof).not.toHaveBeenCalled()
    expect(mockConsumeGoogleSignupProof).not.toHaveBeenCalled()
  })

  it("accepts a verified onboarding marker when the live lookup is degraded and empty", async () => {
    currentUser = {
      id: "u1",
      email: "user@example.com",
      app_metadata: { provider: "google", providers: ["google"] },
    }
    googleUser = true
    directoryState = { memberships: [], degradedRegions: ["usw"] }
    mockReadVerifiedGoogleOnboardingMembership.mockResolvedValue({
      teamId: "team-old",
      region: "use",
    })

    await provisionTeam("usw", "u1", "user@example.com", "west pilot")

    expect(mockReadVerifiedGoogleOnboardingMembership).toHaveBeenCalledWith(
      "u1",
    )
    expect(mockRequireGoogleSignupProof).not.toHaveBeenCalled()
    expect(mockConsumeGoogleSignupProof).not.toHaveBeenCalled()
  })

  it("fails transiently when the lookup is degraded and no marker can recover it", async () => {
    currentUser = {
      id: "u1",
      email: "user@example.com",
      app_metadata: { provider: "google", providers: ["google"] },
    }
    googleUser = true
    directoryState = { memberships: [], degradedRegions: ["usw"] }
    mockReadVerifiedGoogleOnboardingMembership.mockResolvedValue(null)

    await expect(
      provisionTeam("usw", "u1", "user@example.com", "west pilot"),
    ).rejects.toThrow("Google membership lookup degraded; please try again")

    expect(mockRequireGoogleSignupProof).not.toHaveBeenCalled()
    expect(mockConsumeGoogleSignupProof).not.toHaveBeenCalled()
    expect(mockEnsureGoogleOnboardingMembership).not.toHaveBeenCalled()
  })

  it("persists the Google onboarding marker after successful first-team provisioning", async () => {
    currentUser = {
      id: "u1",
      email: "user@example.com",
      app_metadata: { provider: "google", providers: ["google"] },
    }
    googleUser = true
    directoryState = { memberships: [], degradedRegions: [] }
    mockRequireGoogleSignupProof.mockResolvedValue(undefined)

    await provisionTeam("usw", "u1", "user@example.com", "west pilot")
  })
})
