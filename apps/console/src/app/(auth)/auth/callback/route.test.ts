import { render, screen, cleanup, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import {
  createElement,
  cloneElement,
  type ReactElement,
  type ReactNode,
} from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

let retrySearch = new URLSearchParams()
const mockRetryOAuth = vi.fn()
vi.mock("next/navigation", () => ({
  useSearchParams: () => retrySearch,
  redirect: (url: string) => {
    throw Object.assign(new Error(url), { redirect: true })
  },
  unstable_rethrow: (error: { redirect?: boolean }) => {
    if (error.redirect) throw error
  },
}))
vi.mock("next/image", () => ({ default: () => null }))
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) =>
    createElement("a", { href }, children),
}))
vi.mock("@/components/corner-brackets", () => ({ CornerBrackets: () => null }))
vi.mock("@/components/dither-background", () => ({
  DitherBackground: () => null,
}))
vi.mock("@/lib/supabase/client", () => ({
  createBrowserClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: null }, error: null }),
      signInWithOAuth: (...args: unknown[]) => mockRetryOAuth(...args),
    },
  }),
}))
vi.mock("@/app/(auth)/auth/signin/google-action", () => ({
  beginGoogleSignIn: async () => "retry-origin",
}))
vi.mock("@superserve/ui", () => ({
  Button: ({
    render: element,
    children,
    ...props
  }: {
    render?: ReactElement
    children?: ReactNode
  }) =>
    element
      ? cloneElement(element, {}, children)
      : createElement("button", props, children),
  Input: () => null,
}))
vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: vi.fn() }),
}))

let currentUser: {
  id: string
  email: string
  created_at: string
  app_metadata: {
    provider: string
    providers?: string[]
    signup_review?: string
    signup_enterprise_pricing_pending?: boolean
  }
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

const mockGetSignupPlanAction = vi.fn()
const mockPrepareTeam = vi.fn()
const mockReadSignupPlan = vi.fn()
vi.mock("@/lib/api/signup-plan-actions", () => ({
  getSignupPlanAction: (...args: unknown[]) => mockGetSignupPlanAction(...args),
}))
vi.mock("@/lib/api/proxy-auth", () => ({
  getAuthApiKeyAndTeamForUser: (...args: unknown[]) => mockPrepareTeam(...args),
}))
vi.mock("@/lib/api/signup-plan-read", () => ({
  readSignupPlan: (...args: unknown[]) => mockReadSignupPlan(...args),
}))
vi.mock("@/lib/admin/impersonation", () => ({
  getImpersonationContext: async () => null,
}))
vi.mock("@/lib/api/active-team", () => ({
  readTeamSelection: async () => null,
  pickActiveTeam: (teams: unknown[]) => teams[0],
}))
vi.mock("@/lib/api/teams-actions", () => ({
  listTeamsAction: async () => ({
    teams: directoryState.memberships.map((t) => ({
      id: t.teamId,
      region: t.region,
      name: "Team",
    })),
  }),
}))

const mockCompleteStaffGoogle = vi.fn()
vi.mock("@/lib/yc/staff-session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/yc/staff-session")>()),
  completeStaffGoogle: (...args: unknown[]) => mockCompleteStaffGoogle(...args),
}))

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
const mockRevokeGoogleSignupAuthorization = vi.fn()
const mockRetainGoogleSignupVisitor = vi.fn()
const mockReadGoogleSignupVisitors = vi.fn()
const mockReadGooglePromotionEvidence = vi.fn()
const mockRetainOriginalGoogleSignup = vi.fn()
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
  GoogleSignupRecoveryRequiredError: class extends Error {},
  hasValidGoogleSignupProof: (...args: unknown[]) =>
    mockHasValidGoogleSignupProof(...args),
  hasValidLegacyGoogleSignupProof: (...args: unknown[]) =>
    mockHasValidLegacyGoogleSignupProof(...args),
  consumeGoogleSignupProof: (...args: unknown[]) =>
    mockConsumeGoogleSignupProof(...args),
  retainOriginalGoogleSignup: (...args: unknown[]) =>
    mockRetainOriginalGoogleSignup(...args),
  readGooglePromotionEvidence: (...args: unknown[]) =>
    mockReadGooglePromotionEvidence(...args),
  revokeGoogleSignupAuthorization: (...args: unknown[]) =>
    mockRevokeGoogleSignupAuthorization(...args),
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

const mockStrictPlans = vi.fn()
const mockPricingVersion = vi.fn()
vi.mock("@/lib/billing/plans-actions", () => ({
  getPricingVersionAction: (...args: unknown[]) => mockPricingVersion(...args),
  getPublicBillingPlansAction: (...args: unknown[]) => mockStrictPlans(...args),
}))
const mockUpdateSignupReview = vi.fn()
vi.mock("@/lib/auth/signup-review-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/signup-review-server")>()),
  updateSignupReviewMetadata: (...args: unknown[]) =>
    mockUpdateSignupReview(...args),
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

const mockSignOut = vi.fn()
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: {
      signOut: (...args: unknown[]) => mockSignOut(...args),
      exchangeCodeForSession: async () => ({
        error: authExchangeError,
        data: {
          session: { access_token: "exchanged-token", user: currentUser },
        },
      }),
      verifyOtp: async () => ({ error: authVerifyOtpError }),
      getUser: async () => ({ data: { user: currentUser } }),
    },
  }),
}))

import { SignupRestrictedError } from "@/lib/auth/signup-restrictions"
import { signSignupDeviceBinding } from "@/lib/fingerprint/binding-proof"
import { STAFF_SESSION_COOKIE } from "@/lib/yc/staff-session"

import { GET } from "./route"

describe("auth callback", () => {
  beforeEach(() => {
    vi.stubEnv("YC_STAFF_UI_ENABLED", "false")
    mockGetSignupPlanAction.mockReset().mockResolvedValue(undefined)
    mockPrepareTeam.mockReset().mockImplementation(async () => {
      const team = { teamId: "created-team", region: "use" }
      directoryState.memberships = [team]
      return { team, apiKey: "server-only" }
    })
    mockReadSignupPlan
      .mockReset()
      .mockImplementation(
        async (userId: string, team: { region: string; teamId: string }) => ({
          userId,
          teamKey: `${team.region}:${team.teamId}`,
          state: "legacy",
          offer: null,
        }),
      )
    mockPricingVersion.mockReset().mockResolvedValue("legacy")
    mockStrictPlans.mockReset().mockImplementation(async () => ({
      pricing_version: await mockPricingVersion(),
      cards: [],
    }))
    mockSignOut.mockReset().mockResolvedValue({ error: null })
    mockUpdateSignupReview.mockReset().mockResolvedValue(undefined)
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
    mockCompleteStaffGoogle.mockReset().mockResolvedValue(null)
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
    mockRevokeGoogleSignupAuthorization.mockReset().mockResolvedValue(undefined)
    mockMarkGoogleSignupAttempt.mockReset().mockResolvedValue(undefined)
    mockRetainOriginalGoogleSignup.mockReset().mockResolvedValue(undefined)
    mockRequireGoogleSignupProof.mockReset()
    mockEnsureGoogleOnboardingMembership
      .mockReset()
      .mockResolvedValue(undefined)
    mockClassifyGoogleMembershipState
      .mockReset()
      .mockImplementation(async () => googleMembershipState)
    mockTrackEvent.mockReset()
  })

  it.each(["first_time", "indeterminate"] as const)(
    "returns verified staff proof without customer onboarding when membership is %s",
    async (kind) => {
      googleMembershipState =
        kind === "first_time" ? { kind } : { kind, degradedRegions: ["use"] }
      proofAvailable = false
      mockCompleteStaffGoogle.mockResolvedValue("signed-staff-proof")

      const response = await GET(
        new Request(
          "https://console.superserve.ai/auth/callback?code=abc&staff_google_nonce=nonce&next=/yc/claim",
        ),
      )

      expect(response.headers.get("location")).toBe(
        "https://console.superserve.ai/admin/yc",
      )
      expect(mockCompleteStaffGoogle).toHaveBeenCalledWith(
        { access_token: "exchanged-token", user: currentUser },
        "nonce",
        currentUser,
      )
      expect(response.cookies.get(STAFF_SESSION_COOKIE)).toMatchObject({
        value: "signed-staff-proof",
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: 900,
      })
      expect(mockListTeamMembershipsForUserDetailed).not.toHaveBeenCalled()
      expect(mockHasValidLegacyGoogleSignupProof).not.toHaveBeenCalled()
      expect(mockEnsureGoogleOnboardingMembership).not.toHaveBeenCalled()
      expect(mockPublishOriginalSignupEvidence).not.toHaveBeenCalled()
      expect(mockNotifySlackOfNewUser).not.toHaveBeenCalled()
      expect(mockSendWelcomeEmail).not.toHaveBeenCalled()
    },
  )

  it("keeps normal signup checks when staff verification fails", async () => {
    googleMembershipState = { kind: "first_time" }
    proofAvailable = false

    const response = await GET(
      new Request(
        "https://console.superserve.ai/auth/callback?code=abc&staff_google_nonce=nonce",
      ),
    )

    expect(response.headers.get("location")).toContain(
      "/auth/signup?complete_google=1",
    )
    expect(response.cookies.get(STAFF_SESSION_COOKIE)).toBeUndefined()
    expect(mockHasValidLegacyGoogleSignupProof).toHaveBeenCalled()
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
      undefined,
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
    expect(mockNotifySlackOfNewUser).toHaveBeenCalledWith(
      "",
      null,
      "email",
      {
        kind: "unavailable",
      },
      undefined,
    )
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
    expect(mockNotifySlackOfNewUser).toHaveBeenCalledWith(
      "",
      null,
      "google",
      {
        kind: "unavailable",
      },
      undefined,
    )
  })

  it("returns confirmed YC onboarding to claim completion after ordinary signup", async () => {
    currentUser!.app_metadata = { provider: "email" }
    evidenceJar.set(
      "yc_claim_confirmation",
      "11111111-1111-4111-8111-111111111111." + "a".repeat(43),
    )
    const response = await GET(
      new Request(
        "https://console.superserve.ai/auth/callback?token_hash=token&type=signup",
      ),
    )
    expect(new URL(response.headers.get("location")!).pathname).toBe(
      "/yc/claim",
    )
    expect(mockEvaluateSignupRestriction).toHaveBeenCalled()
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

  it("retains the verified OAuth actor before redirecting through signup recovery", async () => {
    googleMembershipState = { kind: "first_time" }
    proofAvailable = false
    const response = await GET(
      new Request(
        "https://console.superserve.ai/auth/callback?code=abc&google_signin_intent=pre-auth-intent&offer=yc_2026",
      ),
    )
    expect(mockRetainOriginalGoogleSignup).toHaveBeenCalledWith(
      "pre-auth-intent",
      currentUser,
    )
    expect(response.headers.get("location")).toContain("complete_google=1")
    expect(
      new URL(response.headers.get("location")!).searchParams.get("offer"),
    ).toBe("yc_2026")
    expect(mockPublishOriginalSignupEvidence).not.toHaveBeenCalled()
    expect(mockNotifySlackOfNewUser).not.toHaveBeenCalled()
  })

  it.each(["degraded", "throws"])(
    "retains the OAuth actor before a membership lookup that %s",
    async (failure) => {
      googleMembershipState = {
        kind: "indeterminate",
        degradedRegions: ["use"],
      }
      mockListTeamMembershipsForUserDetailed.mockImplementationOnce(
        async () => {
          expect(mockRetainOriginalGoogleSignup).toHaveBeenCalledWith(
            "pre-auth-intent",
            currentUser,
          )
          if (failure === "throws") throw new Error("directory unavailable")
          return { memberships: [], degradedRegions: ["use"] }
        },
      )
      const result = GET(
        new Request(
          "https://console.superserve.ai/auth/callback?code=abc&google_signin_intent=pre-auth-intent",
        ),
      )
      expect((await result).headers.get("location")).toContain(
        "membership_lookup_degraded",
      )
      expect(mockPublishOriginalSignupEvidence).not.toHaveBeenCalled()
      expect(mockMarkGoogleSignupAttempt).not.toHaveBeenCalled()
    },
  )

  it("keeps the CAPTCHA recovery redirect when origin retention fails", async () => {
    googleMembershipState = { kind: "first_time" }
    proofAvailable = false
    mockRetainOriginalGoogleSignup.mockRejectedValue(
      new Error("cookie write failed"),
    )
    const response = await GET(
      new Request(
        "https://console.superserve.ai/auth/callback?code=abc&google_signin_intent=pre-auth-intent",
      ),
    )
    expect(response.headers.get("location")).toContain("complete_google=1")
    expect(mockPublishOriginalSignupEvidence).not.toHaveBeenCalled()
  })

  it("lets an established Google user through without requiring proof", async () => {
    googleMembershipState = {
      kind: "existing",
      membership: { teamId: "team-1", region: "use" },
    }

    const response = await GET(
      new Request("https://console.superserve.ai/auth/callback?code=abc"),
    )

    expect(mockRetainOriginalGoogleSignup).not.toHaveBeenCalled()
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

  it.each([
    ["pro_annual", "pro_annual"],
    ["yc_2026", "yc_2026"],
    ["arbitrary_plan", undefined],
  ])(
    "passes only a valid Google callback offer to Slack: %s",
    async (offer, expected) => {
      googleMembershipState = { kind: "first_time" }
      const response = await GET(
        new Request(
          `https://console.superserve.ai/auth/callback?code=abc&signup_attempt_id=attempt-1&offer=${offer}`,
        ),
      )
      expect(response.headers.get("location")).toContain(
        offer === "pro_annual" ? "/billing/pro/" : "/sandboxes",
      )
      const offerCookie = response.cookies.get("ss-plan-offer")
      if (expected)
        expect(JSON.parse(offerCookie!.value)).toEqual({
          userId: "u1",
          offer: expected,
        })
      else expect(offerCookie?.value).toBe("")
      expect(mockNotifySlackOfNewUser).toHaveBeenCalledWith(
        "user@example.com",
        "Test User",
        "google",
        { kind: "unavailable" },
        expected,
      )
    },
  )

  it("preserves an email signup offer after a delayed confirmation", async () => {
    currentUser!.app_metadata = { provider: "email" }
    currentUser!.created_at = new Date(Date.now() - 3600000).toISOString()
    const response = await GET(
      new Request(
        "https://console.superserve.ai/auth/callback?token_hash=token&type=signup&offer=pro_monthly",
      ),
    )
    expect(JSON.parse(response.cookies.get("ss-plan-offer")!.value)).toEqual({
      userId: "u1",
      offer: "pro_monthly",
    })
  })

  it.each(["code=abc", "token_hash=token&type=signup"])(
    "preserves the YC approval locator through %s",
    async (auth) => {
      if (auth.startsWith("token_hash"))
        currentUser!.app_metadata = { provider: "email" }
      const next = "/yc/accept?claim=11111111-1111-4111-8111-111111111111"
      const response = await GET(
        new Request(
          `https://console.superserve.ai/auth/callback?${auth}&next=${encodeURIComponent(next)}`,
        ),
      )
      const destination = new URL(response.headers.get("location")!)
      expect(destination.pathname + destination.search).toBe(next)
    },
  )

  it("returns normal Google sign-in to guarded staff review with its claim locator", async () => {
    vi.stubEnv("YC_STAFF_UI_ENABLED", "true")
    currentUser!.email = "operator@superserve.ai"
    const next = "/admin/yc?claim=11111111-1111-4111-8111-111111111111"
    const response = await GET(
      new Request(
        `https://console.superserve.ai/auth/callback?code=abc&next=${encodeURIComponent(next)}`,
      ),
    )
    expect(response.headers.get("location")).toBe(
      `https://console.superserve.ai${next}`,
    )
    expect(mockCompleteStaffGoogle).not.toHaveBeenCalled()
    expect(response.cookies.get(STAFF_SESSION_COOKIE)).toBeUndefined()
    expect(mockClassifyGoogleMembershipState).toHaveBeenCalled()
  })

  it.each([
    ["false", "/admin/yc?claim=11111111-1111-4111-8111-111111111111"],
    ["true", "/admin/yc?claim=bad"],
    ["true", "/admin/yc?state=approved"],
  ])(
    "keeps disabled or invalid staff recovery on normal navigation (%s, %s)",
    async (enabled, next) => {
      vi.stubEnv("YC_STAFF_UI_ENABLED", enabled)
      const response = await GET(
        new Request(
          `https://console.superserve.ai/auth/callback?code=abc&next=${encodeURIComponent(next)}`,
        ),
      )
      expect(response.headers.get("location")).toBe(
        "https://console.superserve.ai/sandboxes",
      )
      expect(response.cookies.get(STAFF_SESSION_COOKIE)).toBeUndefined()
    },
  )

  it("does not bypass normal signup proof for a staff recovery destination", async () => {
    vi.stubEnv("YC_STAFF_UI_ENABLED", "true")
    currentUser!.email = "operator@superserve.ai"
    googleMembershipState = { kind: "first_time" }
    proofAvailable = false
    const response = await GET(
      new Request(
        "https://console.superserve.ai/auth/callback?code=abc&next=%2Fadmin%2Fyc",
      ),
    )
    expect(response.headers.get("location")).toContain(
      "/auth/signup?complete_google=1",
    )
    expect(mockHasValidLegacyGoogleSignupProof).toHaveBeenCalled()
    expect(response.cookies.get(STAFF_SESSION_COOKIE)).toBeUndefined()
  })

  it("does not turn a claimed readiness parameter into an acceptance destination", async () => {
    const response = await GET(
      new Request(
        "https://console.superserve.ai/auth/callback?code=abc&next=%2Fyc%2Faccept%3Fstate%3Dfunding_ready",
      ),
    )
    expect(new URL(response.headers.get("location")!).pathname).toBe(
      "/sandboxes",
    )
  })

  it("retains Pro recovery markers through OAuth without accepting a claimed paid state", async () => {
    const next =
      "/billing/pro/?billing=success&team=use%3Aoriginal&return=%2Fsandboxes"
    const response = await GET(
      new Request(
        `https://console.superserve.ai/auth/callback?code=abc&next=${encodeURIComponent(next)}`,
      ),
    )
    const destination = new URL(response.headers.get("location")!)
    expect(destination.pathname + destination.search).toBe(next)
    const forged = await GET(
      new Request(
        `https://console.superserve.ai/auth/callback?code=abc&next=${encodeURIComponent("/billing/pro/?approved=true")}`,
      ),
    )
    expect(new URL(forged.headers.get("location")!).pathname).toBe("/sandboxes")
  })

  it("preserves checkout account and team through OAuth reauthentication", async () => {
    const next =
      "/onboarding/plan/?team=use%3Aoriginal&account=u1&billing=success"
    const response = await GET(
      new Request(
        `https://console.superserve.ai/auth/callback?code=abc&next=${encodeURIComponent(next)}`,
      ),
    )
    expect(new URL(response.headers.get("location")!).pathname).toBe(
      "/onboarding/plan/",
    )
    expect(
      new URL(response.headers.get("location")!).searchParams.get("team"),
    ).toBe("use:original")
    expect(
      new URL(response.headers.get("location")!).searchParams.get("account"),
    ).toBe("u1")
    expect(
      new URL(response.headers.get("location")!).searchParams.get("billing"),
    ).toBe("success")
  })

  it("does not route an existing customer's offer as a new signup", async () => {
    const response = await GET(
      new Request(
        "https://console.superserve.ai/auth/callback?code=abc&offer=pro_annual",
      ),
    )
    expect(mockNotifySlackOfNewUser).not.toHaveBeenCalled()
    expect(response.cookies.get("ss-plan-offer")?.value).toBe("")
  })

  describe("pricing v2 signup", () => {
    const firstTimeGoogle = (offer: string) => {
      googleMembershipState = { kind: "first_time" }
      mockHasValidGoogleSignupProof.mockResolvedValue(true)
      return GET(
        new Request(
          `https://console.superserve.ai/auth/callback?code=abc&signup_attempt_id=attempt-1&signup_offer=${offer}`,
        ),
      )
    }

    it("keeps today's signup when the switch is off, whatever the offer", async () => {
      const response = await firstTimeGoogle("enterprise")

      expect(mockUpdateSignupReview).not.toHaveBeenCalled()
      expect(mockSignOut).not.toHaveBeenCalled()
      expect(new URL(response.headers.get("location")!).pathname).toBe(
        "/sandboxes",
      )
      expect(mockSendWelcomeEmail).toHaveBeenCalled()
      expect(mockNotifySlackOfNewUser).toHaveBeenCalledWith(
        "user@example.com",
        "Test User",
        "google",
        { kind: "unavailable" },
        undefined,
      )
    })

    it("keeps a v2 offer through the Google signup recovery page", async () => {
      googleMembershipState = { kind: "first_time" }
      proofAvailable = false
      const response = await GET(
        new Request(
          "https://console.superserve.ai/auth/callback?code=abc&google_signin_intent=pre-auth-intent&signup_offer=enterprise",
        ),
      )
      const location = new URL(response.headers.get("location")!)
      expect(location.searchParams.get("complete_google")).toBe("1")
      expect(location.searchParams.get("signup_offer")).toBe("enterprise")
      expect(mockUpdateSignupReview).not.toHaveBeenCalled()
    })

    it("signs out and reports an error when the Enterprise hold can't be recorded", async () => {
      mockPricingVersion.mockResolvedValue("v2")
      mockUpdateSignupReview.mockRejectedValue(new Error("auth down"))

      const response = await firstTimeGoogle("enterprise")

      expect(mockMarkGoogleSignupAttempt).not.toHaveBeenCalled()
      expect(mockRevokeGoogleSignupAuthorization).toHaveBeenCalledWith(
        "u1",
        "attempt-1",
      )
      expect(mockSignOut).toHaveBeenCalled()
      expect(mockSendWelcomeEmail).not.toHaveBeenCalled()
      expect(new URL(response.headers.get("location")!).pathname).toBe(
        "/auth/auth-code-error",
      )
    })

    it("revokes provisioning proof when recording the Enterprise hold fails", async () => {
      const proofs = await vi.importActual<
        typeof import("@/lib/auth/google-signup-proof")
      >("@/lib/auth/google-signup-proof")
      const previousSecret = process.env.GOOGLE_SIGNUP_PROOF_SECRET
      process.env.GOOGLE_SIGNUP_PROOF_SECRET =
        "a-secret-with-at-least-thirty-two-characters"
      try {
        await proofs.issueGoogleSignupProof("attempt-1")
        mockHasValidGoogleSignupProof.mockImplementation(
          proofs.hasValidGoogleSignupProof,
        )
        mockMarkGoogleSignupAttempt.mockImplementation(
          proofs.markGoogleSignupAttempt,
        )
        mockRevokeGoogleSignupAuthorization.mockImplementation(
          proofs.revokeGoogleSignupAuthorization,
        )
        mockPricingVersion.mockResolvedValue("v2")
        mockUpdateSignupReview.mockRejectedValue(new Error("auth down"))
        await firstTimeGoogle("enterprise")
        await expect(proofs.requireGoogleSignupProof("u1")).rejects.toThrow()
        expect(mockMarkGoogleSignupAttempt).not.toHaveBeenCalled()
        expect(mockSignOut).toHaveBeenCalled()
      } finally {
        if (previousSecret === undefined)
          delete process.env.GOOGLE_SIGNUP_PROOF_SECRET
        else process.env.GOOGLE_SIGNUP_PROOF_SECRET = previousSecret
      }
    })

    it("keeps selected Starter navigation when catalog entry is unavailable", async () => {
      mockPricingVersion.mockResolvedValue("legacy")
      const response = await GET(
        new Request(
          "https://console.superserve.ai/auth/callback?code=abc&signup_offer=starter",
        ),
      )
      expect(new URL(response.headers.get("location")!).pathname).toBe(
        "/plan-usage/buy-credit",
      )
      expect(mockUpdateSignupReview).not.toHaveBeenCalled()
    })

    it.each(["code=abc", "token_hash=token&type=signup"])(
      "fails closed before Enterprise provisioning if current pricing cannot be read: %s",
      async (proof) => {
        googleMembershipState = { kind: "first_time" }
        mockStrictPlans.mockRejectedValue(new Error("Pricing unavailable"))
        const response = await GET(
          new Request(
            `https://console.superserve.ai/auth/callback?${proof}&signup_offer=enterprise`,
          ),
        )
        expect(
          new URL(response.headers.get("location")!).searchParams.get("reason"),
        ).toBe("pricing_unavailable")
        expect(mockSignOut).toHaveBeenCalled()
        expect(mockEnsureGoogleOnboardingMembership).not.toHaveBeenCalled()
        if (proof.startsWith("code="))
          expect(mockUpdateSignupReview).toHaveBeenCalledWith("u1", {
            signup_enterprise_pricing_pending: true,
          })
        else expect(mockUpdateSignupReview).not.toHaveBeenCalled()
        expect(mockSendWelcomeEmail).not.toHaveBeenCalled()
      },
    )

    it("carries Enterprise through the rendered error retry, Google sign-in and callback recovery", async () => {
      googleMembershipState = { kind: "first_time" }
      mockStrictPlans.mockRejectedValue(new Error("catalog down"))
      mockUpdateSignupReview.mockImplementation(async (_id, metadata) =>
        Object.assign(currentUser!.app_metadata, metadata),
      )
      const failed = await firstTimeGoogle("enterprise")
      retrySearch = new URL(failed.headers.get("location")!).searchParams
      const ErrorPage = (await import("../auth-code-error/page")).default
      render(createElement(ErrorPage))
      const retry = new URL(
        screen.getByRole("link", { name: "Try Again" }).getAttribute("href")!,
        "https://console.superserve.ai",
      )
      expect(retry.pathname).toBe("/auth/signin")
      cleanup()
      retrySearch = retry.searchParams
      mockRetryOAuth.mockResolvedValue({ error: null })
      const SignInPage = (await import("../signin/page")).default
      render(createElement(SignInPage))
      await userEvent.click(
        screen.getByRole("button", { name: "Continue with Google" }),
      )
      await waitFor(() => expect(mockRetryOAuth).toHaveBeenCalled())
      const callback = new URL(
        mockRetryOAuth.mock.lastCall![0].options.redirectTo,
      )
      expect(callback.searchParams.get("signup_offer")).toBe("enterprise")
      callback.searchParams.set("code", "retry")
      mockStrictPlans.mockResolvedValue({ pricing_version: "v2", cards: [] })
      const recovered = await GET(new Request(callback))
      expect(new URL(recovered.headers.get("location")!).pathname).toBe(
        "/auth/pending",
      )
      expect(currentUser!.app_metadata.signup_review).toBe("pending")
      expect(mockEnsureGoogleOnboardingMembership).not.toHaveBeenCalled()
      expect(mockSendWelcomeEmail).not.toHaveBeenCalled()
      cleanup()
    }, 20_000)

    it.each(["approved", "pending", "rejected"])(
      "does not change a real %s review on Enterprise retry",
      async (status) => {
        googleMembershipState = { kind: "first_time" }
        currentUser!.app_metadata.signup_review = status
        mockStrictPlans.mockRejectedValue(new Error("catalog down"))
        await GET(
          new Request(
            "https://console.superserve.ai/auth/callback?code=abc&signup_offer=enterprise",
          ),
        )
        expect(mockUpdateSignupReview).not.toHaveBeenCalled()
        expect(currentUser!.app_metadata.signup_review).toBe(status)
      },
    )

    it("revokes signup authorization and never provisions if saving unresolved classification fails", async () => {
      googleMembershipState = { kind: "first_time" }
      mockStrictPlans.mockRejectedValue(new Error("catalog down"))
      mockUpdateSignupReview.mockRejectedValue(new Error("auth write down"))
      await firstTimeGoogle("enterprise")
      expect(mockRevokeGoogleSignupAuthorization).toHaveBeenCalledWith(
        "u1",
        "attempt-1",
      )
      expect(mockSignOut).toHaveBeenCalled()
      expect(mockEnsureGoogleOnboardingMembership).not.toHaveBeenCalled()
    })

    it.each(["v2", "legacy"])(
      "retains first-time Enterprise classification without a retry URL, resolving %s authoritatively",
      async (pricing) => {
        googleMembershipState = { kind: "first_time" }
        mockStrictPlans.mockRejectedValue(new Error("catalog down"))
        mockUpdateSignupReview.mockImplementation(async (_id, metadata) => {
          Object.assign(currentUser!.app_metadata, metadata)
        })
        const failed = await firstTimeGoogle("enterprise")
        const failure = new URL(failed.headers.get("location")!)
        expect(failure.searchParams.get("signup_offer")).toBe("enterprise")
        expect(
          currentUser!.app_metadata.signup_enterprise_pricing_pending,
        ).toBe(true)
        expect(mockEnsureGoogleOnboardingMembership).not.toHaveBeenCalled()
        mockStrictPlans.mockResolvedValue({
          pricing_version: pricing,
          cards: [],
        })
        const retry = await GET(
          new Request(
            "https://console.superserve.ai/auth/callback?code=retry&signup_attempt_id=attempt-1",
          ),
        )
        expect(
          currentUser!.app_metadata.signup_enterprise_pricing_pending,
        ).toBe(false)
        if (pricing === "v2") {
          expect(currentUser!.app_metadata.signup_review).toBe("pending")
          expect(new URL(retry.headers.get("location")!).pathname).toBe(
            "/auth/pending",
          )
          expect(mockEnsureGoogleOnboardingMembership).not.toHaveBeenCalled()
        } else {
          expect(currentUser!.app_metadata.signup_review).toBeUndefined()
          expect(new URL(retry.headers.get("location")!).pathname).toBe(
            "/sandboxes",
          )
        }
      },
    )

    it.each([undefined, "approved"])(
      "lets proven existing Google customers sign in during Enterprise catalog failure (%s)",
      async (status) => {
        currentUser!.app_metadata.signup_review = status
        mockStrictPlans.mockRejectedValue(new Error("catalog down"))
        const response = await GET(
          new Request(
            "https://console.superserve.ai/auth/callback?code=abc&signup_offer=enterprise",
          ),
        )
        expect(new URL(response.headers.get("location")!).pathname).toBe(
          "/sandboxes",
        )
        expect(mockSignOut).not.toHaveBeenCalled()
        expect(mockUpdateSignupReview).not.toHaveBeenCalled()
        expect(mockEnsureGoogleOnboardingMembership).not.toHaveBeenCalled()
        expect(mockPricingVersion).not.toHaveBeenCalled()
        expect(currentUser!.app_metadata.signup_review).toBe(status)
      },
    )

    it.each(["pending", "rejected"])(
      "never bypasses an existing customer's real %s hold during catalog failure",
      async (status) => {
        currentUser!.app_metadata.signup_review = status
        mockStrictPlans.mockRejectedValue(new Error("catalog down"))
        const response = await GET(
          new Request(
            "https://console.superserve.ai/auth/callback?code=abc&signup_offer=enterprise",
          ),
        )
        expect(new URL(response.headers.get("location")!).pathname).toBe(
          "/auth/pending",
        )
        expect(mockSignOut).toHaveBeenCalled()
        expect(mockUpdateSignupReview).not.toHaveBeenCalled()
        expect(mockEnsureGoogleOnboardingMembership).not.toHaveBeenCalled()
      },
    )

    it("does not use a partially degraded existing directory to bypass Enterprise admission", async () => {
      directoryState.degradedRegions = ["euw"]
      mockStrictPlans.mockRejectedValue(new Error("catalog down"))
      const response = await GET(
        new Request(
          "https://console.superserve.ai/auth/callback?code=abc&signup_offer=enterprise",
        ),
      )
      expect(
        new URL(response.headers.get("location")!).searchParams.get("reason"),
      ).toBe("pricing_unavailable")
      expect(mockSignOut).toHaveBeenCalled()
      expect(mockUpdateSignupReview).not.toHaveBeenCalled()
      expect(mockEnsureGoogleOnboardingMembership).not.toHaveBeenCalled()
    })

    it("does not admit degraded membership reads during Enterprise catalog failure", async () => {
      googleMembershipState = {
        kind: "indeterminate",
        degradedRegions: ["use"],
      }
      mockStrictPlans.mockRejectedValue(new Error("catalog down"))
      const response = await GET(
        new Request(
          "https://console.superserve.ai/auth/callback?code=abc&signup_offer=enterprise",
        ),
      )
      expect(
        new URL(response.headers.get("location")!).searchParams.get("reason"),
      ).toBe("pricing_unavailable")
      expect(mockSignOut).toHaveBeenCalled()
      expect(mockUpdateSignupReview).not.toHaveBeenCalled()
      expect(mockEnsureGoogleOnboardingMembership).not.toHaveBeenCalled()
    })

    it("retains explicit legacy Enterprise email confirmation without inventing a hold", async () => {
      mockStrictPlans.mockResolvedValue({
        pricing_version: "legacy",
        cards: [],
      })
      currentUser!.app_metadata = { provider: "email" }
      const response = await GET(
        new Request(
          "https://console.superserve.ai/auth/callback?token_hash=token&type=signup&signup_offer=enterprise",
        ),
      )
      expect(new URL(response.headers.get("location")!).pathname).toBe(
        "/sandboxes",
      )
      expect(mockUpdateSignupReview).not.toHaveBeenCalled()
      expect(mockSignOut).not.toHaveBeenCalled()
    })

    it("does not ask for the switch without an offer", async () => {
      googleMembershipState = { kind: "first_time" }
      mockHasValidGoogleSignupProof.mockResolvedValue(true)
      await GET(
        new Request(
          "https://console.superserve.ai/auth/callback?code=abc&signup_attempt_id=attempt-1",
        ),
      )
      expect(mockPricingVersion).not.toHaveBeenCalled()
    })

    it("holds a new Enterprise account without access", async () => {
      mockPricingVersion.mockResolvedValue("v2")

      const response = await firstTimeGoogle("enterprise")

      expect(mockUpdateSignupReview).toHaveBeenCalledWith("u1", {
        signup_review: "pending",
      })
      expect(mockUpdateSignupReview.mock.invocationCallOrder[0]).toBeLessThan(
        mockMarkGoogleSignupAttempt.mock.invocationCallOrder[0],
      )
      expect(
        mockMarkGoogleSignupAttempt.mock.invocationCallOrder[0],
      ).toBeLessThan(
        mockReadGooglePromotionEvidence.mock.invocationCallOrder[0],
      )
      expect(mockSignOut).toHaveBeenCalled()
      expect(mockSendWelcomeEmail).not.toHaveBeenCalled()
      expect(mockNotifySlackOfNewUser).toHaveBeenCalledWith(
        "user@example.com",
        "Test User",
        "google",
        { kind: "unavailable" },
        undefined,
        true,
      )
      expect(new URL(response.headers.get("location")!).pathname).toBe(
        "/auth/pending",
      )
    })

    it.each([
      ["free", "/sandboxes"],
      ["starter", "/plan-usage/buy-credit"],
      ["pro", "/billing/pro/"],
      ["pro_monthly", "/billing/pro/"],
      ["pro_annual", "/billing/pro/"],
      ["retired_offer", "/billing/pro/"],
    ])("routes a new %s signup to %s", async (offer, destination) => {
      mockPricingVersion.mockResolvedValue("v2")

      const response = await firstTimeGoogle(offer)

      expect(mockUpdateSignupReview).not.toHaveBeenCalled()
      expect(new URL(response.headers.get("location")!).pathname).toBe(
        destination,
      )
    })

    it.each(["v2", "legacy"])(
      "keeps recognized aliases through OAuth and email confirmation under %s entry",
      async (version) => {
        mockPricingVersion.mockResolvedValue(version)
        for (const [offer, destination] of [
          ["starter_monthly", "/plan-usage/buy-credit"],
          ["pro_annual", "/billing/pro/"],
        ]) {
          for (const proof of ["code=abc", "token_hash=token&type=signup"]) {
            const response = await GET(
              new Request(
                `https://console.superserve.ai/auth/callback?${proof}&signup_offer=${offer}`,
              ),
            )
            expect(new URL(response.headers.get("location")!).pathname).toBe(
              destination,
            )
          }
        }
        expect(mockUpdateSignupReview).not.toHaveBeenCalled()
      },
    )

    it.each([
      "/billing/pro/?team=use%3Ateam&return=%2Fsandboxes",
      "/plan-usage/buy-credit?amount=500",
    ])(
      "keeps direct no-offer email confirmation destination %s",
      async (next) => {
        const url = new URL(
          "https://console.superserve.ai/auth/callback?token_hash=abc123&type=signup",
        )
        url.searchParams.set("next", next)
        const response = await GET(new Request(url))
        const location = new URL(response.headers.get("location")!)
        expect(location.pathname + location.search).toBe(next)
        expect(mockPricingVersion).not.toHaveBeenCalled()
      },
    )

    it.each([
      ["starter", "/plan-usage/buy-credit/"],
      ["pro_monthly", "/billing/pro/"],
    ])(
      "finishes first-team preparation before the fresh %s confirmation destination",
      async (offer, next) => {
        currentUser!.app_metadata = { provider: "email" }
        const action = await vi.importActual<
          typeof import("@/lib/api/signup-plan-actions")
        >("@/lib/api/signup-plan-actions")
        const { getSignupPlanPage } = await import("@/lib/api/signup-plan-page")
        mockGetSignupPlanAction.mockImplementation(action.getSignupPlanAction)
        const read = await vi.importActual<
          typeof import("@/lib/api/signup-plan-read")
        >("@/lib/api/signup-plan-read")
        mockReadSignupPlan.mockImplementation(read.readSignupPlan)
        const originalCell = mockCellFor.getMockImplementation()!
        mockCellFor.mockImplementation((...args: unknown[]) => {
          const original = originalCell(...args)
          return {
            ...original,
            createAdminClient: () => {
              const admin = original.createAdminClient()
              return {
                ...admin,
                from: (table: string) => {
                  if (table === "billing_signup_choice")
                    return {
                      select: () => ({
                        eq: () => ({
                          maybeSingle: async () => ({
                            data: { state: "selecting", offer_key: null },
                            error: null,
                          }),
                        }),
                      }),
                    }
                  if (table === "team_plan_assignment")
                    return {
                      select: () => ({
                        eq: () => ({
                          lte: () => ({
                            or: () => ({
                              limit: async () => ({
                                data: directoryState.memberships.length
                                  ? [{ id: "initial-free-assignment" }]
                                  : [],
                                error: null,
                              }),
                            }),
                          }),
                        }),
                      }),
                    }
                  return admin.from(table)
                },
              }
            },
          }
        })
        // This is the dashboard's real no-membership branch. Before the fix it
        // replaced the selected payment page with generic plan setup/sandboxes.
        await expect(getSignupPlanPage()).rejects.toThrow(
          "/api/onboarding/prepare/",
        )
        const url = new URL(
          "https://console.superserve.ai/auth/callback?token_hash=official&type=signup",
        )
        url.searchParams.set("offer", offer)
        url.searchParams.set("signup_offer", offer)
        url.searchParams.set("next", next)
        const response = await GET(new Request(url))
        expect(new URL(response.headers.get("location")!).pathname).toBe(next)
        expect(mockPrepareTeam).toHaveBeenCalledWith(
          currentUser,
          expect.any(String),
        )
        expect(mockGetSignupPlanAction).toHaveBeenCalledWith(
          undefined,
          "u1",
          undefined,
          next,
        )
        // The real destination dashboard context now resolves the created Free
        // team's legacy picker exemption; no preparation or plan-picker detour.
        const page = await getSignupPlanPage()
        expect(page?.context.teamKey).toBe("use:created-team")
        expect(page?.context.state).toBe("legacy")
        expect(mockUpdateSignupReview).not.toHaveBeenCalled()
      },
    )

    it("retains the paid continuation and actor when first-team preparation fails", async () => {
      currentUser!.app_metadata = { provider: "email" }
      mockGetSignupPlanAction.mockRejectedValueOnce(new Error("Response lost"))
      const response = await GET(
        new Request(
          "https://console.superserve.ai/auth/callback?token_hash=official&type=signup&signup_offer=starter&next=%2Fplan-usage%2Fbuy-credit%2F",
        ),
      )
      const location = new URL(response.headers.get("location")!)
      expect(location.pathname).toBe("/auth/auth-code-error")
      expect(location.searchParams.get("reason")).toBe("account_setup")
      expect(location.searchParams.get("next")).toBe("/plan-usage/buy-credit/")
      expect(location.searchParams.get("account")).toBe("u1")
    })

    it("retries a failed first-team confirmation through expired-session reauthentication without losing Starter", async () => {
      currentUser!.app_metadata = { provider: "email" }
      const owner = currentUser!
      const action = await vi.importActual<
        typeof import("@/lib/api/signup-plan-actions")
      >("@/lib/api/signup-plan-actions")
      const { GET: prepare } =
        await import("@/app/api/onboarding/prepare/route")
      mockGetSignupPlanAction.mockImplementation(action.getSignupPlanAction)
      mockPrepareTeam.mockRejectedValueOnce(
        new Error("Provision response lost"),
      )
      const response = await GET(
        new Request(
          "https://console.superserve.ai/auth/callback?token_hash=official&type=signup&signup_offer=starter&next=%2Fplan-usage%2Fbuy-credit%2F",
        ),
      )
      const recovery = new URL(response.headers.get("location")!)
      expect(recovery.searchParams.get("reason")).toBe("account_setup")
      const retry = new URL("/api/onboarding/prepare/", recovery)
      retry.searchParams.set("account", recovery.searchParams.get("account")!)
      retry.searchParams.set("next", recovery.searchParams.get("next")!)
      currentUser = null
      const signin = await prepare(new Request(retry)).catch(
        (error) => new URL(error.message, retry),
      )
      if (!signin) throw new Error("Expected reauthentication")
      expect(signin.pathname).toBe("/auth/signin")
      const authenticatedNext = signin.searchParams.get("next")!
      expect(new URL(authenticatedNext, signin).searchParams.get("next")).toBe(
        "/plan-usage/buy-credit/",
      )
      currentUser = owner
      const callback = new URL(
        "https://console.superserve.ai/auth/callback?token_hash=renewed&type=magiclink",
      )
      callback.searchParams.set("next", authenticatedNext)
      const authenticated = await GET(new Request(callback))
      const prepared = await prepare(
        new Request(authenticated.headers.get("location")!),
      ).catch((error) => new URL(error.message, retry))
      if (!prepared) throw new Error("Expected paid destination")
      expect(prepared.pathname).toBe("/plan-usage/buy-credit/")
      expect(directoryState.memberships).toEqual([
        { teamId: "created-team", region: "use" },
      ])
    })

    it.each(["starter", "pro_monthly"])(
      "renders an account-bound %s retry after the earlier email directory read degrades",
      async (offer) => {
        currentUser!.app_metadata = { provider: "email" }
        directoryState = { memberships: [], degradedRegions: ["use"] }
        const next =
          offer === "starter" ? "/plan-usage/buy-credit/" : "/billing/pro/"
        const url = new URL(
          "https://console.superserve.ai/auth/callback?token_hash=official&type=signup",
        )
        url.searchParams.set("signup_offer", offer)
        url.searchParams.set("next", next)
        const response = await GET(new Request(url))
        const failure = new URL(response.headers.get("location")!)
        expect(mockGetSignupPlanAction).not.toHaveBeenCalled()
        retrySearch = failure.searchParams
        const ErrorPage = (await import("../auth-code-error/page")).default
        render(createElement(ErrorPage))
        const retry = new URL(
          screen.getByRole("link", { name: "Try Again" }).getAttribute("href")!,
          url,
        )
        cleanup()
        expect(retry.pathname).toBe("/api/onboarding/prepare/")
        expect(retry.searchParams.get("next")).toBe(next)
        expect(retry.searchParams.get("account")).toBe("u1")
        expect(mockEvaluateSignupRestriction).not.toHaveBeenCalled()
        // A fresh retry still uses the existing verified-account setup action;
        // this redirect is navigation, not membership or payment authorization.
      },
    )

    it.each(["starter", "pro_monthly"])(
      "preserves default %s offer intent when the email directory read throws",
      async (offer) => {
        currentUser!.app_metadata = { provider: "email" }
        mockListTeamMembershipsForUserDetailed.mockRejectedValueOnce(
          new Error("Directory unavailable"),
        )
        const response = await GET(
          new Request(
            `https://console.superserve.ai/auth/callback?token_hash=official&type=signup&signup_offer=${offer}`,
          ),
        )
        const failure = new URL(response.headers.get("location")!)
        expect(failure.searchParams.get("reason")).toBe("account_setup")
        expect(failure.searchParams.get("account")).toBe("u1")
        expect(failure.searchParams.get("next")).toBe(
          offer === "starter" ? "/plan-usage/buy-credit" : "/billing/pro/",
        )
        expect(mockGetSignupPlanAction).not.toHaveBeenCalled()
      },
    )

    it("retains the existing preparation account and pinned team on a degraded Google lookup", async () => {
      googleMembershipState = {
        kind: "indeterminate",
        degradedRegions: ["use"],
      }
      const preparation =
        "/api/onboarding/prepare/?account=original&team=use%3Aoriginal-team&next=%2Fbilling%2Fpro%2F"
      const url = new URL(
        "https://console.superserve.ai/auth/callback?code=abc",
      )
      url.searchParams.set("next", preparation)
      const response = await GET(new Request(url))
      const failure = new URL(response.headers.get("location")!)
      expect(failure.pathname).toBe("/auth/signup")
      expect(failure.searchParams.get("complete_google")).toBe("1")
      const savedPreparation = new URL(failure.searchParams.get("next")!, url)
      expect(savedPreparation.pathname).toBe("/api/onboarding/prepare/")
      expect(savedPreparation.searchParams.get("account")).toBe("original")
      const paid = new URL(savedPreparation.searchParams.get("next")!, url)
      expect(paid.pathname).toBe("/billing/pro/")
      expect(paid.searchParams.get("team")).toBe("use:original-team")
      expect(mockGetSignupPlanAction).not.toHaveBeenCalled()
      expect(mockMarkGoogleSignupAttempt).not.toHaveBeenCalled()
    })

    it("sends a real unbound Google proof through completion rather than looping first-team preparation", async () => {
      vi.stubEnv(
        "GOOGLE_SIGNUP_PROOF_SECRET",
        "test-google-proof-secret-at-least-32-characters",
      )
      const proof = await vi.importActual<
        typeof import("@/lib/auth/google-signup-proof")
      >("@/lib/auth/google-signup-proof")
      await proof.issueGoogleSignupProof("early-unbound-attempt")
      const before = [...evidenceJar]
      googleMembershipState = {
        kind: "indeterminate",
        degradedRegions: ["use"],
      }
      const response = await GET(
        new Request(
          "https://console.superserve.ai/auth/callback?code=abc&signup_attempt_id=early-unbound-attempt&signup_offer=starter&next=%2Fplan-usage%2Fbuy-credit%2F",
        ),
      )
      const recovery = new URL(response.headers.get("location")!)
      expect(recovery.pathname).toBe("/auth/signup")
      expect(recovery.searchParams.get("complete_google")).toBe("1")
      const preparation = new URL(recovery.searchParams.get("next")!, recovery)
      expect(preparation.searchParams.get("account")).toBe("u1")
      expect(preparation.searchParams.get("next")).toBe(
        "/plan-usage/buy-credit/",
      )
      expect([...evidenceJar]).toEqual(before)
      expect(mockMarkGoogleSignupAttempt).not.toHaveBeenCalled()
      expect(mockGetSignupPlanAction).not.toHaveBeenCalled()
      // This real guard cannot use an unbound scoped proof without completion.
      // After that gate binds the proof, the same actor's guard succeeds.
      await expect(proof.requireGoogleSignupProof("u1")).rejects.toThrow(
        "Google signup verification required",
      )
      await proof.markGoogleSignupAttempt("early-unbound-attempt", "u1")
      await expect(proof.requireGoogleSignupProof("u1")).resolves.toBe(
        "early-unbound-attempt",
      )
    })

    it.each(["https://evil.test", "//evil.test", "/billing/pro?approved=true"])(
      "does not turn unsafe next into a paid retry on degraded lookup: %s",
      async (next) => {
        currentUser!.app_metadata = { provider: "email" }
        directoryState = { memberships: [], degradedRegions: ["use"] }
        const url = new URL(
          "https://console.superserve.ai/auth/callback?token_hash=official&type=signup&signup_offer=starter",
        )
        url.searchParams.set("next", next)
        const response = await GET(new Request(url))
        const failure = new URL(response.headers.get("location")!)
        expect(failure.searchParams.get("reason")).toBe(
          "membership_lookup_degraded",
        )
        expect(failure.searchParams.get("account")).toBeNull()
        expect(failure.searchParams.get("next")).toBeNull()
      },
    )

    it("keeps Enterprise directory degradation out of self-serve preparation", async () => {
      mockStrictPlans.mockResolvedValue({ pricing_version: "v2", cards: [] })
      googleMembershipState = {
        kind: "indeterminate",
        degradedRegions: ["use"],
      }
      const response = await GET(
        new Request(
          "https://console.superserve.ai/auth/callback?code=abc&signup_offer=enterprise&next=%2Fbilling%2Fpro%2F",
        ),
      )
      const failure = new URL(response.headers.get("location")!)
      expect(failure.searchParams.get("reason")).toBe(
        "membership_lookup_degraded",
      )
      expect(failure.searchParams.get("next")).toBeNull()
      expect(mockGetSignupPlanAction).not.toHaveBeenCalled()
      expect(mockUpdateSignupReview).not.toHaveBeenCalled()
    })

    it("keeps an outer-only team pin through the real handler, rendered recovery, and retry", async () => {
      const action = await vi.importActual<
        typeof import("@/lib/api/signup-plan-actions")
      >("@/lib/api/signup-plan-actions")
      const read = await vi.importActual<
        typeof import("@/lib/api/signup-plan-read")
      >("@/lib/api/signup-plan-read")
      const { GET: prepare } =
        await import("@/app/api/onboarding/prepare/route")
      mockGetSignupPlanAction.mockImplementation(action.getSignupPlanAction)
      mockReadSignupPlan.mockImplementation(read.readSignupPlan)
      const request = new Request(
        "https://console.superserve.ai/api/onboarding/prepare/?account=u1&team=use%3Aoriginal-team&next=%2Fbilling%2Fpro%2F",
      )
      const failure = await prepare(request).catch(
        (error) => new URL(error.message, request.url),
      )
      if (!failure) throw new Error("Expected team recovery")
      expect(failure.searchParams.get("reason")).toBe("team_changed")
      retrySearch = failure.searchParams
      const ErrorPage = (await import("../auth-code-error/page")).default
      render(createElement(ErrorPage))
      const retry = new URL(
        screen
          .getByRole("link", {
            name: "Continue after selecting the original team",
          })
          .getAttribute("href")!,
        request.url,
      )
      cleanup()
      const paid = new URL(retry.searchParams.get("next")!, retry)
      expect(paid.searchParams.get("team")).toBe("use:original-team")
      // The currently selected created-team must still be rejected; recovery
      // cannot silently retarget the original checkout to that different team.
      const again = await prepare(new Request(retry)).catch(
        (error) => new URL(error.message, retry),
      )
      if (!again) throw new Error("Expected binding to remain blocked")
      expect(again.searchParams.get("reason")).toBe("team_changed")
      expect(mockGetSignupPlanAction).toHaveBeenLastCalledWith(
        "use:original-team",
        "u1",
        undefined,
        "/billing/pro/?team=use%3Aoriginal-team",
      )
    })

    it("keeps an account-bound paid preparation return through reauthentication", async () => {
      currentUser!.app_metadata = { provider: "email" }
      const next =
        "/api/onboarding/prepare/?account=u1&next=%2Fbilling%2Fpro%2F"
      const url = new URL(
        "https://console.superserve.ai/auth/callback?token_hash=official&type=magiclink",
      )
      url.searchParams.set("next", next)
      const response = await GET(new Request(url))
      const destination = new URL(response.headers.get("location")!)
      expect(destination.pathname + destination.search).toBe(next)
      expect(mockGetSignupPlanAction).not.toHaveBeenCalled()
    })

    it("routes by the legacy offer parameter when no v2 offer was sent", async () => {
      mockPricingVersion.mockResolvedValue("v2")
      currentUser!.app_metadata = { provider: "email" }
      const response = await GET(
        new Request(
          "https://console.superserve.ai/auth/callback?token_hash=token&type=signup&offer=pro_monthly",
        ),
      )
      expect(new URL(response.headers.get("location")!).pathname).toBe(
        "/billing/pro/",
      )
    })

    it("routes an existing customer to the selected Starter purchase", async () => {
      mockPricingVersion.mockResolvedValue("v2")
      const response = await GET(
        new Request(
          "https://console.superserve.ai/auth/callback?code=abc&signup_offer=starter",
        ),
      )
      expect(new URL(response.headers.get("location")!).pathname).toBe(
        "/plan-usage/buy-credit",
      )
    })

    it.each([
      ["offer=pro_monthly", "/billing/pro/"],
      ["offer=free", "/sandboxes"],
      ["signup_offer=enterprise", "/sandboxes"],
      [
        "signup_offer=starter&next=%2Fbilling%2Fpro%3Fbilling%3Dsuccess%26team%3Duse%253Aoriginal",
        "/billing/pro",
      ],
      [
        "signup_offer=pro_monthly&next=%2Fplan-usage%2Fbuy-credit%3Fpurchase%3Dsuccess%26team%3Duse%253Aoriginal",
        "/plan-usage/buy-credit",
      ],
    ])(
      "preserves existing account intent or explicit payment return: %s",
      async (query, path) => {
        mockPricingVersion.mockResolvedValue("v2")
        const response = await GET(
          new Request(
            `https://console.superserve.ai/auth/callback?code=abc&${query}`,
          ),
        )
        const location = new URL(response.headers.get("location")!)
        expect(location.pathname).toBe(path)
        if (query.includes("next="))
          expect(location.searchParams.get("team")).toBe("use:original")
        expect(mockUpdateSignupReview).not.toHaveBeenCalled()
      },
    )

    it.each(["pending", "rejected"])(
      "signs a %s account out before any onboarding work",
      async (status) => {
        currentUser!.app_metadata = { provider: "email", signup_review: status }
        const response = await GET(
          new Request(
            "https://console.superserve.ai/auth/callback?token_hash=token&type=signup",
          ),
        )
        expect(mockSignOut).toHaveBeenCalled()
        expect(mockEvaluateSignupRestriction).not.toHaveBeenCalled()
        expect(mockSendWelcomeEmail).not.toHaveBeenCalled()
        expect(new URL(response.headers.get("location")!).pathname).toBe(
          "/auth/pending",
        )
      },
    )
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
      undefined,
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
        undefined,
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
        "attempt-1",
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
      undefined,
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
      "attempt-1",
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
      "attempt-1",
    )
    expect(mockNotifySlackOfNewUser).toHaveBeenCalledWith(
      "user@example.com",
      "Test User",
      "google",
      { kind: "unavailable" },
      undefined,
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
          undefined,
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
        undefined,
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
      undefined,
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
      undefined,
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
      undefined,
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
        await signUpWithEmail(
          "user@example.com",
          "password123",
          "Test User",
          undefined,
          undefined,
          undefined,
          "pro_monthly",
        ),
      ).toEqual({ success: true })
      const confirmationUrl = new URL(
        mockSendConfirmationEmail.mock.lastCall![0].react,
      )
      expect(confirmationUrl.searchParams.get("offer")).toBe("pro_monthly")
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
      mockNotifySlackOfNewUser.mockClear()
      const response = await GET(new Request(confirmationUrl))
      expect(mockNotifySlackOfNewUser.mock.lastCall![4]).toBe("pro_monthly")
      expect(response.headers.get("location")).toContain("/billing/pro/")
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
