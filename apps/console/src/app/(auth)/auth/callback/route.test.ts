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
let authExchangeError: { message: string } | null = null
let authVerifyOtpError: { message: string } | null = null

const mockNotifySlackOfNewUser = vi.fn()
vi.mock("@/lib/slack/signup-notification", () => ({
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
const mockConsumeFingerprintSignupEventId = vi.fn()
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
  consumeFingerprintSignupEventId: (...args: unknown[]) =>
    mockConsumeFingerprintSignupEventId(...args),
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
const mockReadGooglePromotionEvidence = vi.fn()
const mockPublishOriginalSignupEvidence = vi.fn()
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
  readGooglePromotionEvidence: (...args: unknown[]) =>
    mockReadGooglePromotionEvidence(...args),
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
vi.mock("@/lib/api/promotion-publication", () => ({
  publishOriginalSignupEvidence: (...args: unknown[]) =>
    mockPublishOriginalSignupEvidence(...args),
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
      exchangeCodeForSession: async () => ({ error: authExchangeError }),
      verifyOtp: async () => ({ error: authVerifyOtpError }),
      getUser: async () => ({ data: { user: currentUser } }),
    },
  }),
}))

import { SignupRestrictedError } from "@/lib/auth/signup-restrictions"
import { signSignupDeviceBinding } from "@/lib/fingerprint/binding-proof"

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
    authExchangeError = null
    authVerifyOtpError = null
    mockNotifySlackOfNewUser.mockReset()
    mockNotifySlackOfNewUser.mockResolvedValue(undefined)
    mockSendWelcomeEmail.mockReset()
    mockSendWelcomeEmail.mockResolvedValue(undefined)
    mockReadFingerprintSignupEventId.mockReset().mockResolvedValue(undefined)
    mockConsumeFingerprintSignupEventId.mockReset().mockResolvedValue(undefined)
    mockResolveFingerprintSignup.mockReset().mockResolvedValue(null)
    mockSaveSignupEvidence.mockReset().mockResolvedValue(undefined)
    mockBeginSignupEvidenceAttempt.mockReset().mockResolvedValue(undefined)
    mockIsActiveSignupEvidenceAttempt.mockReset().mockResolvedValue(true)
    mockIsSupersededSignupEvidenceAttempt.mockReset().mockResolvedValue(false)
    mockGenerateSignupLink.mockReset()
    mockSendConfirmationEmail.mockReset().mockResolvedValue({ success: true })
    mockVerifySignupRecaptcha.mockReset().mockResolvedValue({ verified: true })
    mockRetainGoogleSignupVisitor.mockReset().mockResolvedValue(undefined)
    mockReadGoogleSignupVisitors.mockReset().mockResolvedValue([])
    mockReadGooglePromotionEvidence.mockReset().mockResolvedValue(undefined)
    mockPublishOriginalSignupEvidence.mockReset().mockResolvedValue(undefined)
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

  it("notifies a generic callback denial without exposing evidence", async () => {
    currentUser!.app_metadata = { provider: "email" }
    mockReadSignupEvidence.mockResolvedValue("VisitorCase")
    mockEvaluateSignupRestriction.mockRejectedValue(new SignupRestrictedError())
    mockNotifySlackOfNewUser.mockRejectedValueOnce(new Error("webhook down"))

    const response = await GET(
      new Request(
        "https://console.superserve.ai/auth/callback?token_hash=token&type=signup&signup_attempt_id=attempt-1",
      ),
    )

    expect(response.headers.get("location")).toContain("reason=signup_blocked")
    expect(response.headers.get("location")).not.toContain("VisitorCase")
    expect(mockNotifySlackOfNewUser).toHaveBeenCalledWith(
      "user@example.com",
      "Test User",
      "email",
      { kind: "blocked" },
    )
  })

  it("uses unavailable for a pre-identity trigger rejection and preserves redirect", async () => {
    authVerifyOtpError = { message: "DATABASE ERROR SAVING NEW USER" }
    mockNotifySlackOfNewUser.mockRejectedValueOnce(new Error("webhook down"))

    const response = await GET(
      new Request(
        "https://console.superserve.ai/auth/callback?token_hash=token&type=signup",
      ),
    )

    expect(response.headers.get("location")).toContain("reason=signup_blocked")
    expect(mockNotifySlackOfNewUser).toHaveBeenCalledWith("", null, "email", {
      kind: "unavailable",
    })
  })

  it("uses unavailable for a pre-identity Google trigger rejection", async () => {
    authExchangeError = { message: "DATABASE ERROR SAVING NEW USER" }
    mockNotifySlackOfNewUser.mockRejectedValueOnce(new Error("webhook down"))

    const response = await GET(
      new Request(
        "https://console.superserve.ai/auth/callback?code=abc&signup_attempt_id=attempt-1",
      ),
    )

    expect(response.headers.get("location")).toContain("reason=signup_blocked")
    expect(mockNotifySlackOfNewUser).toHaveBeenCalledWith("", null, "google", {
      kind: "unavailable",
    })
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
      { kind: "unavailable" },
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

  it.each([
    [
      "eligible",
      {
        ownership: "owner",
        deviceDecision: "eligible",
        eligibility: "unknown",
        reason: "team_checks_pending",
      },
      { kind: "eligible" },
    ],
    [
      "pre-confirmation identity unavailable",
      {
        ownership: "owner",
        deviceDecision: "eligible",
        eligibility: "unknown",
        reason: "verified_identity_missing",
      },
      { kind: "eligible" },
    ],
    [
      "historical identity unresolved",
      {
        ownership: "owner",
        deviceDecision: "eligible",
        eligibility: "unknown",
        reason: "historical_identity_unresolved",
      },
      { kind: "eligible" },
    ],
    [
      "another owner",
      {
        ownership: "another_owner",
        deviceDecision: "owner_conflict",
        eligibility: "ineligible",
        reason: "owner_conflict",
      },
      { kind: "enforced_other_owner" },
    ],
    [
      "missing evidence",
      {
        ownership: "evidence_missing",
        deviceDecision: "evidence_missing",
        eligibility: "ineligible",
        reason: "evidence_missing",
      },
      { kind: "enforced_missing_evidence" },
    ],
    [
      "device already redeemed",
      {
        ownership: "owner",
        deviceDecision: "device_already_redeemed",
        eligibility: "ineligible",
        reason: "device_already_redeemed",
      },
      { kind: "enforced_device_redeemed" },
    ],
    [
      "another owner with enforcement bypassed",
      {
        ownership: "another_owner",
        deviceDecision: "eligible",
        eligibility: "unknown",
        reason: "team_checks_pending",
      },
      { kind: "unavailable" },
    ],
    [
      "missing evidence with enforcement bypassed",
      {
        ownership: "evidence_missing",
        deviceDecision: "eligible",
        eligibility: "unknown",
        reason: "team_checks_pending",
      },
      { kind: "unavailable" },
    ],
    [
      "non-device eligibility denial",
      {
        ownership: "owner",
        deviceDecision: "eligible",
        eligibility: "ineligible",
        reason: "identity_already_claimed",
      },
      { kind: "unavailable" },
    ],
  ] as const)(
    "publishes before notifying with the authoritative Google %s snapshot",
    async (_label, snapshot, expected) => {
      googleMembershipState = { kind: "first_time" }
      mockHasValidGoogleSignupProof.mockResolvedValue(true)
      mockReadGooglePromotionEvidence.mockResolvedValue({
        originalSignup: true,
        attemptId: "original-attempt",
        routineMissing: false,
      })
      mockPublishOriginalSignupEvidence.mockImplementation(
        async (publishedUser, attemptId, routineMissing) => {
          if (
            publishedUser !== currentUser ||
            attemptId !== "original-attempt" ||
            routineMissing !== false
          )
            return undefined
          return snapshot
        },
      )

      const response = await GET(
        new Request(
          "https://console.superserve.ai/auth/callback?code=abc&signup_attempt_id=attempt-1",
        ),
      )

      expect(response.headers.get("location")).toContain("/sandboxes")
      expect(mockNotifySlackOfNewUser).toHaveBeenCalledWith(
        "user@example.com",
        "Test User",
        "google",
        expected,
      )
      expect(mockReadGooglePromotionEvidence).toHaveBeenCalledWith(
        "attempt-1",
        "u1",
        currentUser!.created_at,
      )
      expect(mockPublishOriginalSignupEvidence).toHaveBeenCalledWith(
        currentUser,
        "original-attempt",
        false,
      )
      expect(
        mockPublishOriginalSignupEvidence.mock.invocationCallOrder[0],
      ).toBeLessThan(mockNotifySlackOfNewUser.mock.invocationCallOrder[0])
    },
  )

  it("uses unavailable when Google publication has no authoritative snapshot", async () => {
    googleMembershipState = { kind: "first_time" }
    mockHasValidGoogleSignupProof.mockResolvedValue(true)
    mockReadGooglePromotionEvidence.mockResolvedValue({
      originalSignup: true,
      attemptId: "original-attempt",
      routineMissing: false,
    })
    mockPublishOriginalSignupEvidence.mockResolvedValue(undefined)

    const response = await GET(
      new Request(
        "https://console.superserve.ai/auth/callback?code=abc&signup_attempt_id=attempt-1",
      ),
    )

    expect(response.headers.get("location")).toContain("/sandboxes")
    expect(mockNotifySlackOfNewUser).toHaveBeenCalledWith(
      "user@example.com",
      "Test User",
      "google",
      { kind: "unavailable" },
    )
    expect(mockReadGooglePromotionEvidence).toHaveBeenCalledWith(
      "attempt-1",
      "u1",
      currentUser!.created_at,
    )
    expect(mockPublishOriginalSignupEvidence).toHaveBeenCalledWith(
      currentUser,
      "original-attempt",
      false,
    )
  })

  it("keeps a no-fingerprint original Google signup unavailable", async () => {
    googleMembershipState = { kind: "first_time" }
    mockHasValidGoogleSignupProof.mockResolvedValue(true)
    mockReadGooglePromotionEvidence.mockResolvedValue({
      originalSignup: true,
      attemptId: undefined,
      routineMissing: true,
    })
    mockPublishOriginalSignupEvidence.mockResolvedValue(undefined)

    const response = await GET(
      new Request(
        "https://console.superserve.ai/auth/callback?code=abc&signup_attempt_id=attempt-1",
      ),
    )

    expect(response.headers.get("location")).toContain("/sandboxes")
    expect(mockPublishOriginalSignupEvidence).toHaveBeenCalledWith(
      currentUser,
      undefined,
      true,
    )
    expect(mockNotifySlackOfNewUser).toHaveBeenCalledWith(
      "user@example.com",
      "Test User",
      "google",
      { kind: "unavailable" },
    )
    expect(
      mockPublishOriginalSignupEvidence.mock.invocationCallOrder[0],
    ).toBeLessThan(mockNotifySlackOfNewUser.mock.invocationCallOrder[0])
  })

  it.each([
    [
      "eligible",
      {
        ownership: "owner",
        deviceDecision: "eligible",
        eligibility: "unknown",
        reason: "team_checks_pending",
      },
      { kind: "eligible" },
    ],
    [
      "another owner",
      {
        ownership: "another_owner",
        deviceDecision: "owner_conflict",
        eligibility: "ineligible",
        reason: "owner_conflict",
      },
      { kind: "enforced_other_owner" },
    ],
    [
      "missing evidence",
      {
        ownership: "evidence_missing",
        deviceDecision: "evidence_missing",
        eligibility: "ineligible",
        reason: "evidence_missing",
      },
      { kind: "enforced_missing_evidence" },
    ],
    [
      "device already redeemed",
      {
        ownership: "owner",
        deviceDecision: "device_already_redeemed",
        eligibility: "ineligible",
        reason: "device_already_redeemed",
      },
      { kind: "enforced_device_redeemed" },
    ],
  ] as const)(
    "publishes a signed email confirmation %s snapshot before notifying",
    async (_label, snapshot, expected) => {
      const previousSecret = process.env.GOOGLE_SIGNUP_PROOF_SECRET
      process.env.GOOGLE_SIGNUP_PROOF_SECRET =
        "a-secret-with-at-least-thirty-two-characters"
      try {
        currentUser!.app_metadata = { provider: "email" }
        const attemptId = "email-confirmation-attempt"
        const proof = signSignupDeviceBinding(currentUser!.id, attemptId)
        expect(proof).toEqual(expect.any(String))

        let resolvePublication: (value: unknown) => void = () => {}
        mockPublishOriginalSignupEvidence.mockImplementation(
          () =>
            new Promise((resolve) => {
              resolvePublication = resolve
            }),
        )

        const responsePromise = GET(
          new Request(
            `https://console.superserve.ai/auth/callback?token_hash=token&type=signup&device_attempt_id=${attemptId}&device_bind_proof=${proof}`,
          ),
        )
        await vi.waitFor(() =>
          expect(mockPublishOriginalSignupEvidence).toHaveBeenCalledTimes(1),
        )
        expect(mockPublishOriginalSignupEvidence).toHaveBeenCalledWith(
          currentUser,
          attemptId,
          false,
        )
        expect(mockNotifySlackOfNewUser).not.toHaveBeenCalled()

        resolvePublication(snapshot)
        const response = await responsePromise

        expect(response.headers.get("location")).toContain("/sandboxes")
        expect(mockNotifySlackOfNewUser).toHaveBeenCalledWith(
          "user@example.com",
          "Test User",
          "email",
          expected,
        )
        expect(
          mockPublishOriginalSignupEvidence.mock.invocationCallOrder[0],
        ).toBeLessThan(mockNotifySlackOfNewUser.mock.invocationCallOrder[0])
      } finally {
        if (previousSecret === undefined)
          delete process.env.GOOGLE_SIGNUP_PROOF_SECRET
        else process.env.GOOGLE_SIGNUP_PROOF_SECRET = previousSecret
      }
    },
  )

  it("uses unavailable when a signed email confirmation publication rejects", async () => {
    const previousSecret = process.env.GOOGLE_SIGNUP_PROOF_SECRET
    process.env.GOOGLE_SIGNUP_PROOF_SECRET =
      "a-secret-with-at-least-thirty-two-characters"
    try {
      currentUser!.app_metadata = { provider: "email" }
      const attemptId = "email-confirmation-attempt"
      const proof = signSignupDeviceBinding(currentUser!.id, attemptId)
      expect(proof).toEqual(expect.any(String))
      mockPublishOriginalSignupEvidence.mockRejectedValueOnce(
        new Error("publication transport unavailable"),
      )
      mockNotifySlackOfNewUser.mockRejectedValueOnce(new Error("webhook down"))

      const response = await GET(
        new Request(
          `https://console.superserve.ai/auth/callback?token_hash=token&type=signup&device_attempt_id=${attemptId}&device_bind_proof=${proof}`,
        ),
      )

      expect(response.headers.get("location")).toContain("/sandboxes")
      expect(mockPublishOriginalSignupEvidence).toHaveBeenCalledWith(
        currentUser,
        attemptId,
        false,
      )
      expect(mockNotifySlackOfNewUser).toHaveBeenCalledWith(
        "user@example.com",
        "Test User",
        "email",
        { kind: "unavailable" },
      )
    } finally {
      if (previousSecret === undefined)
        delete process.env.GOOGLE_SIGNUP_PROOF_SECRET
      else process.env.GOOGLE_SIGNUP_PROOF_SECRET = previousSecret
    }
  })

  it("continues the Google callback with unavailable when publication rejects", async () => {
    googleMembershipState = { kind: "first_time" }
    mockHasValidGoogleSignupProof.mockResolvedValue(true)
    mockReadGooglePromotionEvidence.mockResolvedValue({
      originalSignup: true,
      attemptId: "original-attempt",
      routineMissing: false,
    })
    mockPublishOriginalSignupEvidence.mockRejectedValueOnce(
      new Error("publication transport unavailable"),
    )
    mockNotifySlackOfNewUser.mockRejectedValueOnce(new Error("webhook down"))

    const response = await GET(
      new Request(
        "https://console.superserve.ai/auth/callback?code=abc&signup_attempt_id=attempt-1",
      ),
    )

    expect(response.headers.get("location")).toContain("/sandboxes")
    expect(mockNotifySlackOfNewUser).toHaveBeenCalledWith(
      "user@example.com",
      "Test User",
      "google",
      { kind: "unavailable" },
    )
    expect(mockSendWelcomeEmail).toHaveBeenCalledWith(
      "user@example.com",
      "Test User",
    )
  })

  it("uses the known email provider when Auth metadata omits it", async () => {
    currentUser!.app_metadata = {} as { provider: string; providers?: string[] }

    const response = await GET(
      new Request(
        "https://console.superserve.ai/auth/callback?token_hash=token&type=signup",
      ),
    )

    expect(response.headers.get("location")).toContain("/sandboxes")
    expect(mockNotifySlackOfNewUser).toHaveBeenCalledWith(
      "user@example.com",
      "Test User",
      "email",
      { kind: "unavailable" },
    )
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
    const { consumeFingerprintSignupEventId } = await vi.importActual<
      typeof import("@/app/(auth)/auth/signup/action")
    >("@/app/(auth)/auth/signup/action")
    googleMembershipState = { kind: "first_time" }
    mockHasValidGoogleSignupProof.mockResolvedValue(true)
    evidenceJar.set("fingerprint_signup_event_id", "event-1")
    mockReadFingerprintSignupEventId.mockResolvedValue("event-1")
    mockConsumeFingerprintSignupEventId.mockImplementation(
      consumeFingerprintSignupEventId,
    )
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
    expect(mockConsumeFingerprintSignupEventId).toHaveBeenCalledExactlyOnceWith(
      "event-1",
    )
    expect(evidenceJar.has("fingerprint_signup_event_id")).toBe(false)
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

  it("leaves a newer attempt's event for its Google callback after supersession", async () => {
    const evidence = await vi.importActual<
      typeof import("@/lib/auth/signup-evidence")
    >("@/lib/auth/signup-evidence")
    const { readFingerprintSignupEventId, consumeFingerprintSignupEventId } =
      await vi.importActual<typeof import("@/app/(auth)/auth/signup/action")>(
        "@/app/(auth)/auth/signup/action",
      )
    const previousSecret = process.env.GOOGLE_SIGNUP_PROOF_SECRET
    process.env.GOOGLE_SIGNUP_PROOF_SECRET =
      "a-secret-with-at-least-thirty-two-characters"
    try {
      googleMembershipState = { kind: "first_time" }
      mockIsActiveSignupEvidenceAttempt.mockImplementation(
        evidence.isActiveSignupEvidenceAttempt,
      )
      mockReadFingerprintSignupEventId.mockImplementation(
        readFingerprintSignupEventId,
      )
      mockConsumeFingerprintSignupEventId.mockImplementation(
        consumeFingerprintSignupEventId,
      )
      mockReadSignupEvidence.mockImplementation(evidence.readSignupEvidence)
      mockSaveSignupEvidence.mockImplementation(evidence.saveSignupEvidence)
      mockResolveFingerprintSignup.mockResolvedValue("VisitorB")
      mockEvaluateSignupRestriction.mockImplementation(
        async (_region, _actor, visitor) => {
          if (visitor === "VisitorB") throw new SignupRestrictedError()
        },
      )

      await evidence.beginSignupEvidenceAttempt("attempt-a")
      await evidence.beginSignupEvidenceAttempt("attempt-b")
      evidenceJar.set("fingerprint_signup_event_id", "event-b")
      const callback = (attempt: string) =>
        GET(
          new Request(
            `https://console.superserve.ai/auth/callback?code=abc&signup_attempt_id=${attempt}`,
          ),
        )

      await callback("attempt-a")
      expect(evidenceJar.get("fingerprint_signup_event_id")).toBe("event-b")
      expect(mockReadFingerprintSignupEventId).not.toHaveBeenCalled()
      expect(mockResolveFingerprintSignup).not.toHaveBeenCalled()
      expect(mockConsumeFingerprintSignupEventId).not.toHaveBeenCalled()

      const response = await callback("attempt-b")
      expect(response.headers.get("location")).toContain(
        "reason=signup_blocked",
      )
      expect(mockResolveFingerprintSignup).toHaveBeenCalledExactlyOnceWith({
        eventId: "event-b",
        userId: "u1",
        signupMethod: "google",
        signupAttemptId: "attempt-b",
      })
      expect(
        mockConsumeFingerprintSignupEventId,
      ).toHaveBeenCalledExactlyOnceWith("event-b")
      expect(await evidence.readSignupEvidence("u1", "attempt-b")).toBe(
        "VisitorB",
      )
    } finally {
      if (previousSecret === undefined)
        delete process.env.GOOGLE_SIGNUP_PROOF_SECRET
      else process.env.GOOGLE_SIGNUP_PROOF_SECRET = previousSecret
    }
  })

  it("preserves a newer event when an older Google callback lookup finishes", async () => {
    const { consumeFingerprintSignupEventId } = await vi.importActual<
      typeof import("@/app/(auth)/auth/signup/action")
    >("@/app/(auth)/auth/signup/action")
    googleMembershipState = { kind: "first_time" }
    evidenceJar.set("fingerprint_signup_event_id", "event-1")
    mockReadFingerprintSignupEventId.mockResolvedValue("event-1")
    mockConsumeFingerprintSignupEventId.mockImplementation(
      consumeFingerprintSignupEventId,
    )
    mockResolveFingerprintSignup.mockImplementation(async () => {
      evidenceJar.set("fingerprint_signup_event_id", "event-2")
      return "VisitorCase"
    })

    await GET(
      new Request(
        "https://console.superserve.ai/auth/callback?code=abc&signup_attempt_id=attempt-1",
      ),
    )

    expect(evidenceJar.get("fingerprint_signup_event_id")).toBe("event-2")
    expect(mockSaveSignupEvidence).toHaveBeenCalledWith(
      "u1",
      "attempt-1",
      "event-1",
      "VisitorCase",
    )
  })

  it("retains Google provisioning authorization when evidence is denied", async () => {
    googleMembershipState = { kind: "first_time" }
    mockHasValidGoogleSignupProof.mockResolvedValue(true)
    mockReadFingerprintSignupEventId.mockResolvedValue(undefined)
    mockReadSignupEvidence.mockResolvedValue("RetainedVisitor")
    mockEvaluateSignupRestriction.mockRejectedValue(new SignupRestrictedError())
    mockNotifySlackOfNewUser.mockRejectedValueOnce(new Error("webhook down"))

    const response = await GET(
      new Request(
        "https://console.superserve.ai/auth/callback?code=abc&signup_attempt_id=attempt-1",
      ),
    )

    expect(response.headers.get("location")).toContain("reason=signup_blocked")
    expect(mockMarkGoogleSignupAttempt).toHaveBeenCalledWith("attempt-1", "u1")
    expect(mockNotifySlackOfNewUser).toHaveBeenCalledWith(
      "user@example.com",
      "Test User",
      "google",
      { kind: "blocked" },
    )
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
