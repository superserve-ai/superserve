import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Mock dependencies before importing the action
const mockGenerateLink = vi.fn()
const mockCloudflareFlagRpc = vi.fn()
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: mockCloudflareFlagRpc,
    auth: {
      admin: {
        generateLink: mockGenerateLink,
      },
    },
  }),
}))

const mockSendEmail = vi.fn()
vi.mock("@/lib/email/send", () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}))

vi.mock("@/lib/email/templates/confirmation", () => ({
  ConfirmationEmail: (props: { confirmationUrl: string }) =>
    `ConfirmationEmail:${props.confirmationUrl}`,
}))

vi.mock("@/lib/email/templates/welcome", () => ({
  WelcomeEmail: (props: { name: string; dashboardUrl: string }) =>
    `WelcomeEmail:${props.name}`,
}))

const mockSlack = vi.fn().mockResolvedValue(undefined)
vi.mock("@/app/(auth)/auth/signin/action", () => ({
  notifySlackOfNewUser: (...args: unknown[]) => mockSlack(...args),
}))

const mockVerifyRecaptcha = vi.fn()
vi.mock("@/lib/recaptcha/verify", () => ({
  verifyRecaptcha: (...args: unknown[]) => mockVerifyRecaptcha(...args),
}))

const mockIssueGoogleSignupProof = vi.fn()
vi.mock("@/lib/auth/google-signup-proof", () => ({
  issueGoogleSignupProof: () => mockIssueGoogleSignupProof(),
}))

const mockObserveCloudflareSignup = vi.fn()
vi.mock("@/lib/cloudflare/signup-observe", () => ({
  observeCloudflareSignup: (...args: unknown[]) =>
    mockObserveCloudflareSignup(...args),
}))

const mockTrackEvent = vi.fn()
vi.mock("@/lib/posthog/actions", () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}))

const mockObserveFingerprintSignup = vi.fn()
const mockResolveFingerprintSignup = vi.fn()
const mockBeginSignupEvidenceAttempt = vi.fn()
const mockSaveSignupEvidence = vi.fn()
const mockIsSupersededSignupEvidenceAttempt = vi.fn()
const mockEvaluateSignupRestriction = vi.fn()
vi.mock("@/lib/auth/signup-restrictions", () => ({
  SignupRestrictedError: class SignupRestrictedError extends Error {},
  SIGNUP_RESTRICTED_MESSAGE: "Signup is not available. Please try again later.",
  evaluateSignupRestriction: (...args: unknown[]) =>
    mockEvaluateSignupRestriction(...args),
}))
vi.mock("@/lib/cells", () => ({
  DEFAULT_REGION: "use",
  cellFor: () => ({ apiBaseUrl: "https://backend.example.test" }),
}))
vi.mock("@/lib/fingerprint/observe", () => ({
  observeFingerprintSignup: (...args: unknown[]) =>
    mockObserveFingerprintSignup(...args),
  resolveFingerprintSignup: (...args: unknown[]) =>
    mockResolveFingerprintSignup(...args),
}))
vi.mock("@/lib/auth/signup-evidence", () => ({
  beginSignupEvidenceAttempt: (...args: unknown[]) =>
    mockBeginSignupEvidenceAttempt(...args),
  isSupersededSignupEvidenceAttempt: (...args: unknown[]) =>
    mockIsSupersededSignupEvidenceAttempt(...args),
  readSignupEvidence: async () => "VisitorCase",
  saveSignupEvidence: (...args: unknown[]) => mockSaveSignupEvidence(...args),
}))

vi.mock("@/lib/posthog/events", () => ({
  AUTH_EVENTS: {
    GOOGLE_SIGNUP_CAPTCHA_FAILED: "auth_google_signup_captcha_failed",
    GOOGLE_SIGNUP_CAPTCHA_VERIFIED: "auth_google_signup_captcha_verified",
    SIGNUP_ATTEMPT_ASSOCIATED: "auth_signup_attempt_associated",
    SIGNUP_RECAPTCHA_OBSERVED: "auth_signup_recaptcha_observed",
    CLOUDFLARE_SIGNUP_OBSERVED: "auth_cloudflare_signup_observed",
    CLOUDFLARE_SIGNUP_OBSERVATION_FAILED:
      "auth_cloudflare_signup_observation_failed",
  },
}))

let fingerprintSignupEventId: string | undefined
const mockFingerprintCookieDelete = vi.fn()
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      fingerprintSignupEventId === undefined
        ? undefined
        : { name, value: fingerprintSignupEventId },
    delete: (name: string) => {
      if (name === "fingerprint_signup_event_id") {
        fingerprintSignupEventId = undefined
      }
      mockFingerprintCookieDelete(name)
    },
  }),
}))

const mockAfter = vi.fn()
vi.mock("next/server", () => ({
  after: (callback: () => void | Promise<void>) => mockAfter(callback),
}))

import { SignupRestrictedError } from "@/lib/auth/signup-restrictions"

import { beginGoogleSignup, signUpWithEmail } from "./action"

// verifyRecaptcha reads these at call time (not module load), so these
// tests — which assert unconfigured (fail-open) behavior and never pass a
// token — need them explicitly cleared rather than relying on the ambient
// environment. A dev/CI env with reCAPTCHA configured would otherwise
// reject every one of these as a missing token.
const ORIGINAL_RECAPTCHA_ENV = {
  RECAPTCHA_API_KEY: process.env.RECAPTCHA_API_KEY,
  RECAPTCHA_PROJECT_ID: process.env.RECAPTCHA_PROJECT_ID,
  NEXT_PUBLIC_RECAPTCHA_SITE_KEY: process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY,
}

describe("post-trial signup with the real Cloudflare observer", () => {
  beforeEach(async () => {
    const { observeCloudflareSignup } = await vi.importActual<
      typeof import("@/lib/cloudflare/signup-observe")
    >("@/lib/cloudflare/signup-observe")
    mockObserveCloudflareSignup
      .mockReset()
      .mockImplementation(observeCloudflareSignup)
    mockCloudflareFlagRpc
      .mockReset()
      .mockResolvedValue({ data: true, error: null })
    mockGenerateLink.mockReset().mockResolvedValue({
      data: { properties: { hashed_token: "abc123" } },
      error: null,
    })
    mockSendEmail.mockReset().mockResolvedValue({ success: true })
    mockSlack.mockReset().mockResolvedValue(undefined)
    mockVerifyRecaptcha.mockReset().mockResolvedValue({ verified: true })
    mockIssueGoogleSignupProof.mockReset().mockResolvedValue(undefined)
    mockTrackEvent.mockReset().mockResolvedValue(undefined)
    fingerprintSignupEventId = undefined
    vi.stubEnv("CLOUDFLARE_TURNSTILE_SECRET_KEY", "fixture-secret")
    vi.stubEnv("CLOUDFLARE_SIGNUP_CAPABILITIES", "turnstile_free,ephemeral_id")
    vi.stubEnv("CLOUDFLARE_SIGNUP_CONFIG_VERSION", "ss-560-expiry-simulation")
    vi.spyOn(console, "info").mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  describe.each(["email", "google"] as const)("%s", (method) => {
    it.each([
      ["missing field", 200, "success", "missing_expected_signal"],
      ["entitlement rejected", 403, "http_403", "unavailable"],
    ] as const)(
      "preserves signup after %s without changing active configuration",
      async (_scenario, status, outcome, signalStatus) => {
        const callbacks: Array<() => void | Promise<void>> = []
        mockAfter.mockReset().mockImplementation((callback) => {
          callbacks.push(callback)
        })
        const fetchSpy = vi
          .spyOn(globalThis, "fetch")
          .mockResolvedValueOnce(
            new Response(
              JSON.stringify({
                success: true,
                metadata: { ephemeral_id: "fixture-native-id" },
              }),
            ),
          )
          .mockResolvedValueOnce(
            new Response(JSON.stringify({ success: true }), { status }),
          )

        for (const expired of [false, true]) {
          const result =
            method === "email"
              ? await signUpWithEmail(
                  "user@test.com",
                  "password123",
                  "Test User",
                  "recaptcha-token",
                  "turnstile-token",
                )
              : await beginGoogleSignup("recaptcha-token", "turnstile-token")
          expect(result.success).toBe(true)
          expect(callbacks).toHaveLength(1)
          await expect(
            Promise.resolve(callbacks.shift()!()),
          ).resolves.toBeUndefined()
          const attemptId =
            mockObserveCloudflareSignup.mock.lastCall![0].signupAttemptId
          expect(mockTrackEvent).toHaveBeenCalledWith(
            "auth_signup_recaptcha_observed",
            attemptId,
            expect.objectContaining({ signup_attempt_id: attemptId }),
          )
          expect(mockTrackEvent).toHaveBeenCalledWith(
            "auth_cloudflare_signup_observed",
            expect.any(String),
            expect.objectContaining({
              signup_attempt_id: attemptId,
              signup_method: method,
              config_version: "ss-560-expiry-simulation",
              capabilities: ["turnstile_free", "ephemeral_id"],
              ephemeral_id_expected: true,
              ephemeral_id: expired ? null : "fixture-native-id",
              ephemeral_id_status: expired ? signalStatus : "success",
              provider_outcome: expired ? outcome : "success",
            }),
          )
        }
        expect(fetchSpy).toHaveBeenCalledTimes(2)
        expect(mockVerifyRecaptcha).toHaveBeenCalledTimes(2)
        expect(mockGenerateLink).toHaveBeenCalledTimes(
          method === "email" ? 2 : 0,
        )
        expect(mockSendEmail).toHaveBeenCalledTimes(method === "email" ? 2 : 0)
        expect(mockIssueGoogleSignupProof).toHaveBeenCalledTimes(
          method === "google" ? 2 : 0,
        )
      },
    )
  })
})

describe("signUpWithEmail", () => {
  beforeEach(() => {
    mockAfter.mockReset().mockImplementation((callback) => callback())
    mockGenerateLink.mockReset()
    mockSendEmail.mockReset()
    mockSlack.mockReset().mockResolvedValue(undefined)
    mockVerifyRecaptcha.mockReset().mockResolvedValue({ verified: true })
    mockIssueGoogleSignupProof.mockReset().mockResolvedValue(undefined)
    mockObserveCloudflareSignup.mockReset().mockResolvedValue(undefined)
    mockTrackEvent.mockReset().mockResolvedValue(undefined)
    mockObserveFingerprintSignup.mockReset().mockResolvedValue(undefined)
    mockResolveFingerprintSignup.mockReset().mockResolvedValue("VisitorCase")
    mockBeginSignupEvidenceAttempt.mockReset().mockResolvedValue(true)
    mockSaveSignupEvidence.mockReset().mockResolvedValue(undefined)
    mockEvaluateSignupRestriction.mockReset().mockResolvedValue(undefined)
    mockIsSupersededSignupEvidenceAttempt.mockReset().mockResolvedValue(false)
    mockFingerprintCookieDelete.mockReset()
    fingerprintSignupEventId = undefined
    delete process.env.RECAPTCHA_API_KEY
    delete process.env.RECAPTCHA_PROJECT_ID
    delete process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY
  })

  afterEach(() => {
    for (const [name, value] of Object.entries(ORIGINAL_RECAPTCHA_ENV)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  })

  it("returns error for invalid email", async () => {
    const result = await signUpWithEmail(
      "not-an-email",
      "password123",
      "Test User",
    )
    expect(result).toEqual({
      success: false,
      error: "Invalid email address.",
    })
    expect(mockGenerateLink).not.toHaveBeenCalled()
  })

  it("returns error for short password", async () => {
    const result = await signUpWithEmail("user@test.com", "short", "Test User")
    expect(result).toEqual({
      success: false,
      error: "Password must be at least 8 characters.",
    })
    expect(mockGenerateLink).not.toHaveBeenCalled()
  })

  it("returns error for empty name", async () => {
    const result = await signUpWithEmail("user@test.com", "password123", "")
    expect(result).toEqual({
      success: false,
      error: "Name is required.",
    })
    expect(mockGenerateLink).not.toHaveBeenCalled()
  })

  it("returns success and sends confirmation email on valid signup", async () => {
    mockGenerateLink.mockResolvedValue({
      data: { properties: { hashed_token: "abc123" } },
      error: null,
    })
    mockSendEmail.mockResolvedValue({ success: true })

    const result = await signUpWithEmail(
      "user@test.com",
      "password123",
      "Test User",
    )

    expect(result).toEqual({ success: true })
    expect(mockGenerateLink).toHaveBeenCalledWith({
      type: "signup",
      email: "user@test.com",
      password: "password123",
      options: {
        data: {
          full_name: "Test User",
          signup_attempt_id: expect.any(String),
        },
        redirectTo: expect.stringContaining("/auth/callback"),
      },
    })
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "user@test.com",
        subject: "Confirm your Superserve account",
      }),
    )
  })

  it("retains the fingerprint cookie across repeated attempts and schedules observe-only telemetry", async () => {
    fingerprintSignupEventId = encodeURIComponent("event-123")
    mockGenerateLink.mockResolvedValue({
      data: {
        user: { id: "user-1" },
        properties: { hashed_token: "abc123" },
      },
      error: null,
    })
    mockSendEmail.mockResolvedValue({ success: true })

    const result = await signUpWithEmail(
      "user@test.com",
      "password123",
      "Test User",
    )
    const secondResult = await signUpWithEmail(
      "user@test.com",
      "password123",
      "Test User",
    )

    expect(result).toEqual({ success: true })
    expect(secondResult).toEqual({ success: true })
    expect(mockFingerprintCookieDelete).not.toHaveBeenCalled()
    expect(fingerprintSignupEventId).toBe("event-123")
    expect(mockResolveFingerprintSignup).toHaveBeenCalledTimes(2)
    expect(mockResolveFingerprintSignup).toHaveBeenNthCalledWith(1, {
      eventId: "event-123",
      signupMethod: "email",
      signupAttemptId: expect.any(String),
    })
    expect(mockResolveFingerprintSignup).toHaveBeenNthCalledWith(2, {
      eventId: "event-123",
      signupMethod: "email",
      signupAttemptId: expect.any(String),
    })
    expect(mockObserveCloudflareSignup).toHaveBeenCalledTimes(2)
    const cloudflareCalls = mockObserveCloudflareSignup.mock.calls.map(
      ([args]) =>
        args as {
          signupAttemptId: string
          signupMethod: "email" | "google"
          userId?: string | null
          teamId?: string | null
        },
    )
    expect(cloudflareCalls[0]).toMatchObject({
      signupMethod: "email",
      userId: undefined,
      teamId: undefined,
    })
    expect(cloudflareCalls[1]).toMatchObject({
      signupMethod: "email",
      userId: undefined,
      teamId: undefined,
    })
    expect(cloudflareCalls[0].signupAttemptId).not.toBe(
      cloudflareCalls[1].signupAttemptId,
    )
    for (const [index, { signupAttemptId }] of cloudflareCalls.entries()) {
      expect(mockResolveFingerprintSignup).toHaveBeenNthCalledWith(
        index + 1,
        expect.objectContaining({ signupAttemptId }),
      )
      expect(mockSaveSignupEvidence).toHaveBeenCalledWith(
        "user-1",
        signupAttemptId,
        "event-123",
        "VisitorCase",
      )
      expect(mockTrackEvent).toHaveBeenCalledWith(
        "auth_signup_recaptcha_observed",
        signupAttemptId,
        expect.objectContaining({ signup_attempt_id: signupAttemptId }),
      )
    }
  })

  it.each([new Error("Cookie write failed")])(
    "sends confirmation after allowed policy despite evidence storage failure: %s",
    async (failure) => {
      fingerprintSignupEventId = "event-123"
      mockGenerateLink.mockResolvedValue({
        data: {
          user: { id: "user-1" },
          properties: { hashed_token: "abc123" },
        },
        error: null,
      })
      mockSaveSignupEvidence.mockRejectedValue(failure)

      await expect(
        signUpWithEmail("user@test.com", "password123", "Test User"),
      ).resolves.toEqual({ success: true })
      const signupAttemptId =
        mockGenerateLink.mock.calls[0][0].options.data.signup_attempt_id
      expect(mockEvaluateSignupRestriction).toHaveBeenCalledWith(
        "use",
        signupAttemptId,
        "VisitorCase",
      )
      expect(mockSendEmail).toHaveBeenCalledTimes(1)
    },
  )

  it("denies with unavailable evidence storage before creating an auth user and allows a later retry", async () => {
    fingerprintSignupEventId = "event-123"
    mockGenerateLink.mockResolvedValue({
      data: { user: { id: "user-1" }, properties: { hashed_token: "abc123" } },
      error: null,
    })
    mockEvaluateSignupRestriction
      .mockRejectedValueOnce(new SignupRestrictedError())
      .mockResolvedValueOnce(undefined)

    await expect(
      signUpWithEmail("user@test.com", "password123", "Test User"),
    ).resolves.toEqual({
      success: false,
      error: "Signup is not available. Please try again later.",
    })
    expect(mockGenerateLink).not.toHaveBeenCalled()
    expect(mockIsSupersededSignupEvidenceAttempt).toHaveBeenCalledWith(
      expect.any(String),
    )
    expect(mockSaveSignupEvidence).not.toHaveBeenCalled()
    expect(mockSendEmail).not.toHaveBeenCalled()

    await expect(
      signUpWithEmail("user@test.com", "password123", "Test User"),
    ).resolves.toEqual({ success: true })
    expect(mockGenerateLink).toHaveBeenCalledTimes(1)
    expect(mockEvaluateSignupRestriction).toHaveBeenCalledTimes(2)
    expect(
      mockEvaluateSignupRestriction.mock.invocationCallOrder[1],
    ).toBeLessThan(mockGenerateLink.mock.invocationCallOrder[0])
    expect(mockSaveSignupEvidence).toHaveBeenCalledWith(
      "user-1",
      expect.any(String),
      "event-123",
      "VisitorCase",
    )
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
  })

  it("skips restriction evaluation for an attempt superseded by a signed context", async () => {
    fingerprintSignupEventId = "event-123"
    mockIsSupersededSignupEvidenceAttempt.mockResolvedValue(true)
    mockGenerateLink.mockResolvedValue({
      data: { user: { id: "user-1" }, properties: { hashed_token: "abc123" } },
      error: null,
    })

    await expect(
      signUpWithEmail("user@test.com", "password123", "Test User"),
    ).resolves.toEqual({ success: true })
    expect(mockEvaluateSignupRestriction).not.toHaveBeenCalled()
  })

  it("evaluates verified evidence when a prior signed cookie remains after the new write fails", async () => {
    fingerprintSignupEventId = "event-123"
    mockBeginSignupEvidenceAttempt.mockResolvedValue(false)
    mockIsSupersededSignupEvidenceAttempt.mockResolvedValue(true)
    mockEvaluateSignupRestriction.mockRejectedValue(new SignupRestrictedError())

    await expect(
      signUpWithEmail("user@test.com", "password123", "Test User"),
    ).resolves.toEqual({
      success: false,
      error: "Signup is not available. Please try again later.",
    })
    expect(mockEvaluateSignupRestriction).toHaveBeenCalledWith(
      "use",
      expect.any(String),
      "VisitorCase",
    )
    expect(mockIsSupersededSignupEvidenceAttempt).not.toHaveBeenCalled()
    expect(mockGenerateLink).not.toHaveBeenCalled()
  })

  it.each(["off", "unavailable"] as const)(
    "keeps email signup fail-open when policy is %s and evidence storage fails",
    async (policy) => {
      const { evaluateSignupRestriction } = await vi.importActual<
        typeof import("@/lib/auth/signup-restrictions")
      >("@/lib/auth/signup-restrictions")
      const previousToken = process.env.INTERNAL_API_TOKEN
      const previousFetch = globalThis.fetch
      try {
        if (policy === "off") process.env.INTERNAL_API_TOKEN = "test-token"
        else delete process.env.INTERNAL_API_TOKEN
        const fetchSpy = vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              mode: "off",
              decision: "allowed",
              matched_subject_type: "none",
            }),
            { status: 200 },
          ),
        )
        globalThis.fetch = fetchSpy
        mockEvaluateSignupRestriction.mockImplementation(
          evaluateSignupRestriction,
        )
        fingerprintSignupEventId = "event-123"
        mockGenerateLink.mockResolvedValue({
          data: {
            user: { id: "user-1" },
            properties: { hashed_token: "abc123" },
          },
          error: null,
        })
        mockSaveSignupEvidence.mockRejectedValue(
          new Error("cookie unavailable"),
        )

        await expect(
          signUpWithEmail("user@test.com", "password123", "Test User"),
        ).resolves.toEqual({ success: true })
        expect(mockSendEmail).toHaveBeenCalledTimes(1)
        expect(fetchSpy).toHaveBeenCalledTimes(policy === "off" ? 1 : 0)
      } finally {
        globalThis.fetch = previousFetch
        if (previousToken === undefined) delete process.env.INTERNAL_API_TOKEN
        else process.env.INTERNAL_API_TOKEN = previousToken
      }
    },
  )

  it.each([true, false])(
    "preserves email signup with reCAPTCHA verified=%s when Cloudflare scheduling throws",
    async (verified) => {
      mockAfter.mockImplementationOnce(() => {
        throw new Error("Request lifecycle unavailable")
      })
      mockVerifyRecaptcha.mockResolvedValue({ verified, reason: "low_score" })
      mockGenerateLink.mockResolvedValue({
        data: { properties: { hashed_token: "abc123" } },
        error: null,
      })
      mockSendEmail.mockResolvedValue({ success: true })

      const result = await signUpWithEmail(
        "user@test.com",
        "password123",
        "Test User",
        "recaptcha-token",
        "turnstile-token",
      )

      expect(mockAfter).toHaveBeenCalledTimes(1)
      expect(mockObserveCloudflareSignup).not.toHaveBeenCalled()
      expect(mockVerifyRecaptcha).toHaveBeenCalledWith(
        "recaptcha-token",
        "signup",
      )
      expect(result).toEqual(
        verified
          ? { success: true }
          : {
              success: false,
              error: "We couldn't verify you're human. Please try again.",
              errorCode: "captcha_failed",
            },
      )
      expect(mockGenerateLink).toHaveBeenCalledTimes(verified ? 1 : 0)
      expect(mockSendEmail).toHaveBeenCalledTimes(verified ? 1 : 0)
    },
  )

  it("returns error when email is already registered", async () => {
    mockGenerateLink.mockResolvedValue({
      data: null,
      error: { message: "User already registered" },
    })

    const result = await signUpWithEmail(
      "existing@test.com",
      "password123",
      "Test User",
    )

    expect(result).toEqual({
      success: false,
      error: "An account with this email already exists.",
    })
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it("returns error message from supabase on other errors", async () => {
    mockGenerateLink.mockResolvedValue({
      data: null,
      error: { message: "Rate limit exceeded" },
    })

    const result = await signUpWithEmail(
      "user@test.com",
      "password123",
      "Test User",
    )

    expect(result).toEqual({
      success: false,
      error: "Rate limit exceeded",
    })
  })

  it("returns error when token hash is missing", async () => {
    mockGenerateLink.mockResolvedValue({
      data: { properties: {} },
      error: null,
    })

    const result = await signUpWithEmail(
      "user@test.com",
      "password123",
      "Test User",
    )

    expect(result).toEqual({
      success: false,
      error: "Failed to generate confirmation link.",
    })
  })

  it("returns generic error on unexpected exception", async () => {
    mockGenerateLink.mockRejectedValue(new Error("network error"))

    const result = await signUpWithEmail(
      "user@test.com",
      "password123",
      "Test User",
    )

    expect(result).toEqual({
      success: false,
      error: "Error creating account. Please try again.",
    })
  })

  it("notifies slack after successful signup (fire and forget)", async () => {
    mockGenerateLink.mockResolvedValue({
      data: { properties: { hashed_token: "abc123" } },
      error: null,
    })
    mockSendEmail.mockResolvedValue({ success: true })
    mockSlack.mockResolvedValue({ success: true })

    await signUpWithEmail("user@test.com", "password123", "Test User")

    // Slack is called fire-and-forget via .catch(), give it a tick
    await new Promise((r) => setTimeout(r, 0))
    expect(mockSlack).toHaveBeenCalled()
  })
})

describe("beginGoogleSignup", () => {
  beforeEach(() => {
    mockAfter.mockReset().mockImplementation((callback) => callback())
    mockObserveCloudflareSignup.mockReset().mockResolvedValue(undefined)
    mockVerifyRecaptcha.mockReset().mockResolvedValue({ verified: true })
    mockIssueGoogleSignupProof.mockReset().mockResolvedValue(undefined)
    mockTrackEvent.mockReset().mockResolvedValue(undefined)
    mockObserveFingerprintSignup.mockReset().mockResolvedValue(undefined)
    mockResolveFingerprintSignup.mockReset().mockResolvedValue("VisitorCase")
    mockSaveSignupEvidence.mockReset().mockResolvedValue(undefined)
    mockFingerprintCookieDelete.mockReset()
    fingerprintSignupEventId = undefined
  })

  it("verifies signup_google before issuing a proof", async () => {
    const result = await beginGoogleSignup("google-token", "turnstile-token")

    expect(result).toEqual({
      success: true,
      signupAttemptId: expect.any(String),
    })
    expect(mockVerifyRecaptcha).toHaveBeenCalledWith(
      "google-token",
      "signup_google",
    )
    expect(mockIssueGoogleSignupProof).toHaveBeenCalled()
    if (!result.success) throw new Error("Expected Google signup to succeed")
    expect(mockAfter).toHaveBeenCalledTimes(1)
    expect(mockObserveCloudflareSignup).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        signupAttemptId: result.signupAttemptId,
        signupMethod: "google",
        turnstileToken: "turnstile-token",
      }),
    )
    expect(mockTrackEvent).toHaveBeenCalledWith(
      "auth_signup_recaptcha_observed",
      result.signupAttemptId,
      expect.objectContaining({ signup_attempt_id: result.signupAttemptId }),
    )
    expect(mockTrackEvent).toHaveBeenCalledWith(
      "auth_google_signup_captcha_verified",
      expect.any(String),
      { stage: "captcha_verification" },
    )
  })

  it.each([true, false])(
    "preserves Google signup with reCAPTCHA verified=%s when Cloudflare scheduling throws",
    async (verified) => {
      mockAfter.mockImplementationOnce(() => {
        throw new Error("Request lifecycle unavailable")
      })
      mockVerifyRecaptcha.mockResolvedValue({ verified, reason: "low_score" })

      const result = await beginGoogleSignup("google-token", "turnstile-token")

      expect(mockAfter).toHaveBeenCalledTimes(1)
      expect(mockObserveCloudflareSignup).not.toHaveBeenCalled()
      expect(mockVerifyRecaptcha).toHaveBeenCalledWith(
        "google-token",
        "signup_google",
      )
      expect(result).toEqual(
        verified
          ? { success: true, signupAttemptId: expect.any(String) }
          : {
              success: false,
              error: "We couldn't verify you're human. Please try again.",
              errorCode: "captcha_failed",
            },
      )
      expect(mockIssueGoogleSignupProof).toHaveBeenCalledTimes(verified ? 1 : 0)
    },
  )

  it("retains the fingerprint cookie for callback-side observation", async () => {
    fingerprintSignupEventId = encodeURIComponent("event-456")

    const result = await beginGoogleSignup("google-token")

    expect(result).toEqual({
      success: true,
      signupAttemptId: expect.any(String),
    })
    expect(mockFingerprintCookieDelete).not.toHaveBeenCalled()
    expect(fingerprintSignupEventId).toBe("event-456")
    expect(mockObserveFingerprintSignup).not.toHaveBeenCalled()
  })

  it("fails closed when proof issuance is unavailable", async () => {
    mockIssueGoogleSignupProof.mockRejectedValue(
      new Error("Google signup proof signing secret is not configured"),
    )

    await expect(beginGoogleSignup("google-token")).resolves.toEqual({
      success: false,
      error: "Google signup is temporarily unavailable. Please try again.",
      errorCode: "proof_unavailable",
    })
    expect(mockTrackEvent).toHaveBeenCalledWith(
      "auth_google_signup_captcha_failed",
      expect.any(String),
      {
        reason: "Google signup proof signing secret is not configured",
        stage: "proof_issuance",
      },
    )
  })

  it("returns a captcha error when reCAPTCHA verification fails", async () => {
    mockVerifyRecaptcha.mockResolvedValue({
      verified: false,
      reason: "low_score",
    })

    await expect(beginGoogleSignup("google-token")).resolves.toEqual({
      success: false,
      error: "We couldn't verify you're human. Please try again.",
      errorCode: "captcha_failed",
    })
    expect(mockIssueGoogleSignupProof).not.toHaveBeenCalled()
    expect(mockTrackEvent).toHaveBeenCalledWith(
      "auth_google_signup_captcha_failed",
      expect.any(String),
      {
        reason: "low_score",
        stage: "captcha_verification",
      },
    )
  })
})
