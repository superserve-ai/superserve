import { beforeEach, describe, expect, it, vi } from "vitest"

let currentUser: {
  id: string
  email: string
  created_at: string
  app_metadata: { provider: string; providers?: string[] }
  user_metadata: { full_name?: string }
} | null = null

let proofAvailable = true
let directoryState = {
  memberships: [] as Array<{ teamId: string; region: string }>,
  degradedRegions: [] as string[],
}
let googleMembershipState:
  | { kind: "existing"; membership: { teamId: string; region: string } }
  | { kind: "first_time" }
  | { kind: "indeterminate"; degradedRegions: string[] } = {
  kind: "existing",
  membership: { teamId: "team-1", region: "use" },
}

const mockNotifySlackOfNewUser = vi.fn()
vi.mock("@/app/(auth)/auth/signin/action", () => ({
  notifySlackOfNewUser: (...args: unknown[]) =>
    mockNotifySlackOfNewUser(...args),
}))

const mockSendWelcomeEmail = vi.fn()
const mockGenerateSignupLink = vi.fn()
const mockSendConfirmationEmail = vi.fn()
const mockVerifySignupRecaptcha = vi.fn()
const mockBeginSignupEvidenceAttempt = vi.fn()
const mockIsActiveSignupEvidenceAttempt = vi.fn()
const mockIsSupersededSignupEvidenceAttempt = vi.fn()
const mockReadFingerprintSignupEventId = vi.fn()
const mockResolveFingerprintSignup = vi.fn()
const mockSaveSignupEvidence = vi.fn()
const mockReadSignupEvidence = vi.fn()
const mockEvaluateSignupRestriction = vi.fn()
const mockCellFor = vi.fn()
const rolelessJoinedTeams = new Set<string>()
const partialOwnerTeams = new Set<string>()
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
    delete: (name: string) => evidenceJar.delete(name),
  }),
}))
vi.mock("@/app/(auth)/auth/signup/action", () => ({
  sendWelcomeEmail: (...args: unknown[]) => mockSendWelcomeEmail(...args),
  readFingerprintSignupEventId: (...args: unknown[]) =>
    mockReadFingerprintSignupEventId(...args),
}))
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    auth: { admin: { generateLink: mockGenerateSignupLink } },
  }),
}))
vi.mock("@/lib/email/send", () => ({
  sendEmail: (...args: unknown[]) => mockSendConfirmationEmail(...args),
}))
vi.mock("@/lib/email/templates/confirmation", () => ({
  ConfirmationEmail: ({ confirmationUrl }: { confirmationUrl: string }) =>
    confirmationUrl,
}))
vi.mock("@/lib/recaptcha/verify", () => ({
  verifyRecaptcha: (...args: unknown[]) => mockVerifySignupRecaptcha(...args),
}))
vi.mock("@/lib/fingerprint/observe", () => ({
  resolveFingerprintSignup: (...args: unknown[]) =>
    mockResolveFingerprintSignup(...args),
}))
vi.mock("@/lib/auth/signup-evidence", () => ({
  beginSignupEvidenceAttempt: (...args: unknown[]) =>
    mockBeginSignupEvidenceAttempt(...args),
  isActiveSignupEvidenceAttempt: (...args: unknown[]) =>
    mockIsActiveSignupEvidenceAttempt(...args),
  isSupersededSignupEvidenceAttempt: (...args: unknown[]) =>
    mockIsSupersededSignupEvidenceAttempt(...args),
  saveSignupEvidence: (...args: unknown[]) => mockSaveSignupEvidence(...args),
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
}))
vi.mock("@/lib/auth/signup-restrictions", () => ({
  SignupRestrictedError: class SignupRestrictedError extends Error {},
  evaluateSignupRestriction: (...args: unknown[]) =>
    mockEvaluateSignupRestriction(...args),
}))
vi.mock("@/lib/cells", () => ({
  DEFAULT_REGION: "use",
  cellFor: (...args: unknown[]) => mockCellFor(...args),
}))

const mockHasValidGoogleSignupProof = vi.fn()
const mockHasValidLegacyGoogleSignupProof = vi.fn()
const mockConsumeGoogleSignupProof = vi.fn()
const mockMarkGoogleSignupAttempt = vi.fn()
const mockRetainGoogleSignupVisitor = vi.fn()
const mockReadGoogleSignupVisitors = vi.fn()
const mockRequireGoogleSignupProof = vi.fn()
const mockEnsureGoogleOnboardingMembership = vi.fn()
const mockListTeamMembershipsForUserDetailed = vi.fn(
  async (_userId: string, _opts?: { maxAgeMs?: number }) => directoryState,
)
const mockClassifyGoogleMembershipState = vi.fn(
  async (
    _userId: string,
    _directory: {
      memberships: Array<{ teamId: string; region: string }>
      degradedRegions: string[]
    },
  ) => googleMembershipState,
)
vi.mock("@/lib/api/team-directory", () => ({
  listTeamMembershipsForUserDetailed: (
    ...args: [string, { maxAgeMs?: number }?]
  ) => mockListTeamMembershipsForUserDetailed(...args),
}))
vi.mock("@/lib/auth/google-signup-proof", () => ({
  hasValidGoogleSignupProof: (...args: unknown[]) =>
    mockHasValidGoogleSignupProof(...args),
  hasValidLegacyGoogleSignupProof: (...args: unknown[]) =>
    mockHasValidLegacyGoogleSignupProof(...args),
  consumeGoogleSignupProof: (...args: unknown[]) =>
    mockConsumeGoogleSignupProof(...args),
  markGoogleSignupAttempt: (...args: unknown[]) =>
    mockMarkGoogleSignupAttempt(...args),
  retainGoogleSignupVisitor: (...args: unknown[]) =>
    mockRetainGoogleSignupVisitor(...args),
  readGoogleSignupVisitors: (...args: unknown[]) =>
    mockReadGoogleSignupVisitors(...args),
  requireGoogleSignupProof: (...args: unknown[]) =>
    mockRequireGoogleSignupProof(...args),
  isGoogleUser: (user: {
    app_metadata?: { provider?: string; providers?: string[] }
  }) =>
    user.app_metadata?.provider === "google" ||
    user.app_metadata?.providers?.includes("google") === true,
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

const mockTrackEvent = vi.fn()
vi.mock("@/lib/posthog/actions", () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}))
vi.mock("@/lib/posthog/events", () => ({
  AUTH_EVENTS: {
    GOOGLE_SIGNUP_BYPASS_BLOCKED: "auth_google_signup_bypass_blocked",
    SIGNUP_ATTEMPT_ASSOCIATED: "auth_signup_attempt_associated",
    SIGN_IN_FAILED: "sign_in_failed",
    SIGN_UP_COMPLETED: "sign_up_completed",
    SIGN_IN_COMPLETED: "sign_in_completed",
  },
}))

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: {
      exchangeCodeForSession: async () => ({ error: null }),
      verifyOtp: async () => ({ error: null }),
      getUser: async () => ({ data: { user: currentUser } }),
    },
  }),
}))

import { SignupRestrictedError } from "@/lib/auth/signup-restrictions"

import { GET } from "./route"

describe("auth callback", () => {
  beforeEach(() => {
    evidenceJar.clear()
    currentUser = {
      id: "u1",
      email: "user@example.com",
      created_at: new Date().toISOString(),
      app_metadata: { provider: "google", providers: ["google"] },
      user_metadata: { full_name: "Test User" },
    }
    directoryState = { memberships: [], degradedRegions: [] }
    googleMembershipState = {
      kind: "existing",
      membership: { teamId: "team-1", region: "use" },
    }
    mockNotifySlackOfNewUser.mockReset()
    mockNotifySlackOfNewUser.mockResolvedValue(undefined)
    mockSendWelcomeEmail.mockReset()
    mockSendWelcomeEmail.mockResolvedValue(undefined)
    mockReadFingerprintSignupEventId.mockReset().mockResolvedValue(undefined)
    mockResolveFingerprintSignup.mockReset().mockResolvedValue(null)
    mockSaveSignupEvidence.mockReset().mockResolvedValue(undefined)
    mockBeginSignupEvidenceAttempt.mockReset().mockResolvedValue(undefined)
    mockIsActiveSignupEvidenceAttempt.mockReset().mockResolvedValue(false)
    mockIsSupersededSignupEvidenceAttempt.mockReset().mockResolvedValue(false)
    mockGenerateSignupLink.mockReset()
    mockSendConfirmationEmail.mockReset().mockResolvedValue({ success: true })
    mockVerifySignupRecaptcha.mockReset().mockResolvedValue({ verified: true })
    mockRetainGoogleSignupVisitor.mockReset().mockResolvedValue(undefined)
    mockReadGoogleSignupVisitors.mockReset().mockResolvedValue([])
    mockReadSignupEvidence.mockReset().mockResolvedValue(null)
    mockEvaluateSignupRestriction.mockReset().mockResolvedValue(undefined)
    rolelessJoinedTeams.clear()
    partialOwnerTeams.clear()
    mockCellFor.mockReset().mockImplementation(() => ({
      createAdminClient: () => ({
        from: (table: string) => ({
          select: () => {
            let teamId = ""
            let ownerLookup = false
            const query = {
              eq: (column: string, value: string) => {
                if (column === "team_id") teamId = value
                if (column === "role" && value === "owner") ownerLookup = true
                return query
              },
              limit: async () => ({
                data:
                  table === "user_role_assignments"
                    ? rolelessJoinedTeams.has(teamId) ||
                      partialOwnerTeams.has(teamId)
                      ? []
                      : [{ id: "assignment" }]
                    : table === "team_memberships"
                      ? [{ id: "membership" }]
                      : ownerLookup && rolelessJoinedTeams.has(teamId)
                        ? [{ profile_id: "existing-owner" }]
                        : partialOwnerTeams.has(teamId)
                          ? [
                              {
                                role: "owner",
                                joined_at: "2026-09-24T00:00:00Z",
                              },
                            ]
                          : [],
                error: null,
              }),
            }
            return query
          },
        }),
      }),
    }))
    mockListTeamMembershipsForUserDetailed
      .mockReset()
      .mockImplementation(async () => directoryState)
    proofAvailable = true
    mockHasValidGoogleSignupProof
      .mockReset()
      .mockImplementation(async () => proofAvailable)
    mockHasValidLegacyGoogleSignupProof
      .mockReset()
      .mockImplementation(async () => proofAvailable)
    mockConsumeGoogleSignupProof.mockReset()
    mockMarkGoogleSignupAttempt.mockReset().mockResolvedValue(undefined)
    mockRequireGoogleSignupProof.mockReset()
    mockEnsureGoogleOnboardingMembership
      .mockReset()
      .mockResolvedValue(undefined)
    mockClassifyGoogleMembershipState
      .mockReset()
      .mockImplementation(async () => googleMembershipState)
    mockTrackEvent.mockReset()
  })

  it("returns a generic callback denial before signup notifications", async () => {
    currentUser!.app_metadata = { provider: "email" }
    mockReadSignupEvidence.mockResolvedValue("VisitorCase")
    mockEvaluateSignupRestriction.mockRejectedValue(new SignupRestrictedError())

    const response = await GET(
      new Request(
        "https://console.superserve.ai/auth/callback?token_hash=token&type=signup&signup_attempt_id=attempt-1",
      ),
    )

    expect(response.headers.get("location")).toContain("reason=signup_blocked")
    expect(response.headers.get("location")).not.toContain("VisitorCase")
    expect(mockNotifySlackOfNewUser).not.toHaveBeenCalled()
  })

  it("does not read active signup evidence for a callback without an attempt ID", async () => {
    currentUser!.app_metadata = { provider: "email" }
    mockReadSignupEvidence.mockResolvedValue("NewerAttemptVisitor")

    const response = await GET(
      new Request(
        "https://console.superserve.ai/auth/callback?token_hash=token&type=signup",
      ),
    )

    expect(response.headers.get("location")).toContain("/sandboxes")
    expect(mockReadSignupEvidence).not.toHaveBeenCalled()
    expect(mockEvaluateSignupRestriction).toHaveBeenCalledWith(
      "use",
      "u1",
      null,
    )
    expect(mockEvaluateSignupRestriction).toHaveBeenCalledTimes(1)
  })

  it("lets an invite callback through without evaluating retained signup evidence", async () => {
    currentUser!.app_metadata = { provider: "email" }
    mockReadSignupEvidence.mockResolvedValue("RestrictedVisitor")
    mockEvaluateSignupRestriction.mockRejectedValue(new SignupRestrictedError())

    const response = await GET(
      new Request(
        "https://console.superserve.ai/auth/callback?token_hash=token&type=invite",
      ),
    )

    expect(new URL(response.headers.get("location")!).pathname).toBe(
      "/sandboxes",
    )
    expect(mockReadSignupEvidence).not.toHaveBeenCalled()
    expect(mockEvaluateSignupRestriction).not.toHaveBeenCalled()
  })

  it("lets an established Google user through without requiring proof", async () => {
    googleMembershipState = {
      kind: "existing",
      membership: { teamId: "team-1", region: "use" },
    }

    const response = await GET(
      new Request("https://console.superserve.ai/auth/callback?code=abc"),
    )

    expect(mockHasValidGoogleSignupProof).not.toHaveBeenCalled()
    expect(mockMarkGoogleSignupAttempt).not.toHaveBeenCalled()
    expect(response.headers.get("location")).toContain("/sandboxes")
    expect(mockTrackEvent).toHaveBeenCalled()
    expect(mockSendWelcomeEmail).not.toHaveBeenCalled()
    expect(proofAvailable).toBe(true)
    expect(mockConsumeGoogleSignupProof).not.toHaveBeenCalled()
  })

  it("treats an active joined member without a role as established at callback", async () => {
    directoryState = {
      memberships: [{ teamId: "joined", region: "use" }],
      degradedRegions: [],
    }
    rolelessJoinedTeams.add("joined")
    mockClassifyGoogleMembershipState.mockImplementation(
      async (_userId, directory) =>
        directory.memberships.length
          ? { kind: "existing", membership: directory.memberships[0] }
          : { kind: "first_time" },
    )

    const response = await GET(
      new Request("https://console.superserve.ai/auth/callback?code=abc"),
    )

    expect(response.headers.get("location")).toContain("/sandboxes")
    expect(mockHasValidGoogleSignupProof).not.toHaveBeenCalled()
    expect(mockEvaluateSignupRestriction).not.toHaveBeenCalled()
  })

  it("keeps an unfinished owner signup subject to proof at callback", async () => {
    directoryState = {
      memberships: [{ teamId: "partial", region: "use" }],
      degradedRegions: [],
    }
    partialOwnerTeams.add("partial")
    proofAvailable = false
    mockClassifyGoogleMembershipState.mockImplementation(
      async (_userId, directory) =>
        directory.memberships.length
          ? { kind: "existing", membership: directory.memberships[0] }
          : { kind: "first_time" },
    )

    const response = await GET(
      new Request("https://console.superserve.ai/auth/callback?code=abc"),
    )

    expect(response.headers.get("location")).toContain("/auth/signup")
    expect(mockHasValidLegacyGoogleSignupProof).toHaveBeenCalled()
    expect(mockEvaluateSignupRestriction).not.toHaveBeenCalled()
  })

  it("accepts an in-flight legacy Google callback without an attempt ID", async () => {
    googleMembershipState = { kind: "first_time" }
    mockHasValidLegacyGoogleSignupProof.mockResolvedValue(true)

    const response = await GET(
      new Request("https://console.superserve.ai/auth/callback?code=abc"),
    )

    expect(mockHasValidLegacyGoogleSignupProof).toHaveBeenCalledWith()
    expect(response.headers.get("location")).toContain("/sandboxes")
    expect(mockConsumeGoogleSignupProof).not.toHaveBeenCalled()
  })

  it("fails transiently when the membership directory is degraded and no marker is available", async () => {
    googleMembershipState = {
      kind: "indeterminate",
      degradedRegions: ["usw"],
    }

    const response = await GET(
      new Request("https://console.superserve.ai/auth/callback?code=abc"),
    )

    expect(mockHasValidGoogleSignupProof).not.toHaveBeenCalled()
    expect(response.headers.get("location")).toContain(
      "/auth/auth-code-error?reason=membership_lookup_degraded",
    )
    expect(mockTrackEvent).toHaveBeenCalledWith("sign_in_failed", "u1", {
      provider: "google",
      email: "user@example.com",
      reason: "membership_lookup_degraded",
    })
  })

  it("lets a first-time Google user through when proof is valid", async () => {
    googleMembershipState = { kind: "first_time" }
    mockHasValidGoogleSignupProof.mockResolvedValue(true)

    const response = await GET(
      new Request(
        "https://console.superserve.ai/auth/callback?code=abc&signup_attempt_id=attempt-1",
      ),
    )

    expect(mockHasValidGoogleSignupProof).toHaveBeenCalledWith("attempt-1")
    expect(mockMarkGoogleSignupAttempt).toHaveBeenCalledWith("attempt-1", "u1")
    expect(mockEvaluateSignupRestriction).toHaveBeenCalledWith(
      "use",
      "u1",
      null,
    )
    expect(response.headers.get("location")).toContain("/sandboxes")
    expect(mockNotifySlackOfNewUser).toHaveBeenCalledWith(
      "user@example.com",
      "Test User",
      "google",
    )
    expect(mockSendWelcomeEmail).toHaveBeenCalledWith(
      "user@example.com",
      "Test User",
    )
    expect(mockConsumeGoogleSignupProof).not.toHaveBeenCalled()
    expect(mockTrackEvent).toHaveBeenCalledWith("sign_up_completed", "u1", {
      provider: "google",
      email: "user@example.com",
      is_new_user: true,
    })
  })

  it("authorizes an ordinary missing-evidence signup after the callback", async () => {
    const proofs = await vi.importActual<
      typeof import("@/lib/auth/google-signup-proof")
    >("@/lib/auth/google-signup-proof")
    const previousSecret = process.env.GOOGLE_SIGNUP_PROOF_SECRET
    process.env.GOOGLE_SIGNUP_PROOF_SECRET =
      "a-secret-with-at-least-thirty-two-characters"
    try {
      googleMembershipState = { kind: "first_time" }
      await proofs.issueGoogleSignupProof("attempt-1")
      mockHasValidGoogleSignupProof.mockImplementation(
        proofs.hasValidGoogleSignupProof,
      )
      mockMarkGoogleSignupAttempt.mockImplementation(
        proofs.markGoogleSignupAttempt,
      )

      const response = await GET(
        new Request(
          "https://console.superserve.ai/auth/callback?code=abc&signup_attempt_id=attempt-1",
        ),
      )

      expect(response.headers.get("location")).toContain("/sandboxes")
      expect(mockEvaluateSignupRestriction).toHaveBeenCalledWith(
        "use",
        "u1",
        null,
      )
      expect(await proofs.requireGoogleSignupProof("u1")).toBe("attempt-1")
    } finally {
      if (previousSecret === undefined)
        delete process.env.GOOGLE_SIGNUP_PROOF_SECRET
      else process.env.GOOGLE_SIGNUP_PROOF_SECRET = previousSecret
    }
  })

  it("associates a first-time Google signup observation with the callback user", async () => {
    googleMembershipState = { kind: "first_time" }
    mockHasValidGoogleSignupProof.mockResolvedValue(true)
    mockReadFingerprintSignupEventId.mockResolvedValue("event-1")
    mockResolveFingerprintSignup.mockResolvedValue("VisitorCase")

    await GET(
      new Request(
        "https://console.superserve.ai/auth/callback?code=abc&signup_attempt_id=attempt-1",
      ),
    )

    expect(mockReadFingerprintSignupEventId).toHaveBeenCalled()
    expect(mockResolveFingerprintSignup).toHaveBeenCalledWith({
      eventId: "event-1",
      userId: "u1",
      signupMethod: "google",
      signupAttemptId: "attempt-1",
    })
    expect(mockSaveSignupEvidence).toHaveBeenCalledWith(
      "u1",
      "attempt-1",
      "event-1",
      "VisitorCase",
    )
    expect(mockTrackEvent).toHaveBeenCalledWith(
      "auth_signup_attempt_associated",
      "u1",
      {
        signup_attempt_id: "attempt-1",
        superserve_user_id: "u1",
        signup_method: "google",
        observed_at: expect.any(String),
      },
    )
  })

  it("retains Google provisioning authorization when evidence is denied", async () => {
    googleMembershipState = { kind: "first_time" }
    mockHasValidGoogleSignupProof.mockResolvedValue(true)
    mockReadFingerprintSignupEventId.mockResolvedValue(undefined)
    mockReadSignupEvidence.mockResolvedValue("RetainedVisitor")
    mockEvaluateSignupRestriction.mockRejectedValue(new SignupRestrictedError())

    const response = await GET(
      new Request(
        "https://console.superserve.ai/auth/callback?code=abc&signup_attempt_id=attempt-1",
      ),
    )

    expect(response.headers.get("location")).toContain("reason=signup_blocked")
    expect(mockMarkGoogleSignupAttempt).toHaveBeenCalledWith("attempt-1", "u1")
  })

  it("reuses verified evidence on a repeated callback and rechecks policy", async () => {
    googleMembershipState = { kind: "first_time" }
    mockReadFingerprintSignupEventId.mockResolvedValue("event-1")
    mockReadSignupEvidence.mockResolvedValue("VisitorCase")
    mockEvaluateSignupRestriction.mockRejectedValue(new SignupRestrictedError())

    const request = () =>
      new Request(
        "https://console.superserve.ai/auth/callback?code=abc&signup_attempt_id=attempt-1",
      )
    expect((await GET(request())).headers.get("location")).toContain(
      "reason=signup_blocked",
    )
    expect((await GET(request())).headers.get("location")).toContain(
      "reason=signup_blocked",
    )
    expect(mockResolveFingerprintSignup).not.toHaveBeenCalled()
    expect(mockEvaluateSignupRestriction).toHaveBeenCalledTimes(2)
    expect(mockEvaluateSignupRestriction).toHaveBeenCalledWith(
      "use",
      "u1",
      "VisitorCase",
    )
  })

  it("hands an email signup's active attempt and verified visitor to its confirmation callback", async () => {
    const evidence = await vi.importActual<
      typeof import("@/lib/auth/signup-evidence")
    >("@/lib/auth/signup-evidence")
    const { signUpWithEmail } = await vi.importActual<
      typeof import("@/app/(auth)/auth/signup/action")
    >("@/app/(auth)/auth/signup/action")
    const previousSecret = process.env.GOOGLE_SIGNUP_PROOF_SECRET
    process.env.GOOGLE_SIGNUP_PROOF_SECRET =
      "a-secret-with-at-least-thirty-two-characters"
    try {
      currentUser!.app_metadata = { provider: "email" }
      evidenceJar.set("fingerprint_signup_event_id", "event-1")
      mockBeginSignupEvidenceAttempt.mockImplementation(
        evidence.beginSignupEvidenceAttempt,
      )
      mockIsActiveSignupEvidenceAttempt.mockImplementation(
        evidence.isActiveSignupEvidenceAttempt,
      )
      mockIsSupersededSignupEvidenceAttempt.mockImplementation(
        evidence.isSupersededSignupEvidenceAttempt,
      )
      mockSaveSignupEvidence.mockImplementation(evidence.saveSignupEvidence)
      mockReadSignupEvidence.mockImplementation(evidence.readSignupEvidence)
      mockResolveFingerprintSignup.mockResolvedValue("VisitorCase")
      mockGenerateSignupLink.mockResolvedValue({
        data: { user: { id: "u1" }, properties: { hashed_token: "token" } },
        error: null,
      })

      expect(
        await signUpWithEmail("user@example.com", "password123", "Test User"),
      ).toEqual({ success: true })
      const confirmationUrl = new URL(
        mockSendConfirmationEmail.mock.lastCall![0].react,
      )
      const attemptId = confirmationUrl.searchParams.get("signup_attempt_id")
      expect(attemptId).toEqual(expect.any(String))
      expect(attemptId).not.toBe("")
      expect(mockBeginSignupEvidenceAttempt).toHaveBeenCalledExactlyOnceWith(
        attemptId,
      )
      expect(await evidence.readSignupEvidence("u1", attemptId!)).toBe(
        "VisitorCase",
      )

      mockEvaluateSignupRestriction.mockClear()
      const response = await GET(new Request(confirmationUrl))
      expect(response.headers.get("location")).toContain("/sandboxes")
      expect(mockEvaluateSignupRestriction).toHaveBeenCalledExactlyOnceWith(
        "use",
        "u1",
        "VisitorCase",
      )
    } finally {
      if (previousSecret === undefined)
        delete process.env.GOOGLE_SIGNUP_PROOF_SECRET
      else process.env.GOOGLE_SIGNUP_PROOF_SECRET = previousSecret
    }
  })

  it("carries the server-verified visitor into a later callback", async () => {
    const evidence = await vi.importActual<
      typeof import("@/lib/auth/signup-evidence")
    >("@/lib/auth/signup-evidence")
    const proofs = await vi.importActual<
      typeof import("@/lib/auth/google-signup-proof")
    >("@/lib/auth/google-signup-proof")
    const previousSecret = process.env.GOOGLE_SIGNUP_PROOF_SECRET
    process.env.GOOGLE_SIGNUP_PROOF_SECRET =
      "a-secret-with-at-least-thirty-two-characters"
    try {
      await proofs.issueGoogleSignupProof("attempt-1")
      await proofs.markGoogleSignupAttempt("attempt-1", "u1")
      for (let i = 0; i < 8; i++)
        await proofs.issueGoogleSignupProof(`other-${i}`)
      mockHasValidGoogleSignupProof.mockImplementation(
        proofs.hasValidGoogleSignupProof,
      )
      mockMarkGoogleSignupAttempt.mockImplementation(
        proofs.markGoogleSignupAttempt,
      )
      await evidence.beginSignupEvidenceAttempt("attempt-1")
      googleMembershipState = { kind: "first_time" }
      mockReadFingerprintSignupEventId.mockResolvedValue("event-1")
      mockResolveFingerprintSignup.mockResolvedValue("VisitorCase")
      mockSaveSignupEvidence.mockImplementation(evidence.saveSignupEvidence)
      mockReadSignupEvidence.mockImplementation(evidence.readSignupEvidence)
      const request = () =>
        new Request(
          "https://console.superserve.ai/auth/callback?code=abc&signup_attempt_id=attempt-1",
        )

      expect((await GET(request())).headers.get("location")).toContain(
        "/sandboxes",
      )
      expect(await evidence.readSignupEvidence("u1", "attempt-1")).toBe(
        "VisitorCase",
      )
      mockEvaluateSignupRestriction.mockRejectedValue(
        new SignupRestrictedError(),
      )
      expect((await GET(request())).headers.get("location")).toContain(
        "reason=signup_blocked",
      )
      expect(await proofs.requireGoogleSignupProof("u1")).toBe("attempt-1")
      expect(await proofs.requireGoogleSignupProof("u1")).toBe("attempt-1")
      expect(mockResolveFingerprintSignup).toHaveBeenCalledTimes(1)
      expect(await evidence.readSignupEvidence("u1", "attempt-1")).toBe(
        "VisitorCase",
      )
    } finally {
      if (previousSecret === undefined)
        delete process.env.GOOGLE_SIGNUP_PROOF_SECRET
      else process.env.GOOGLE_SIGNUP_PROOF_SECRET = previousSecret
    }
  })
})
