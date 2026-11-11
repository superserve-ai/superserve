/**
 * sign-in link action — the response must not reveal whether an address
 * belongs to an account. Every lookup and send runs in `after()`, so the
 * result is decided before any of that work starts.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

const mockGenerateLink = vi.fn()
const mockFindUser = vi.fn()
const mockSendEmail = vi.fn()
const mockVerifyRecaptcha = vi.fn()
const mockTrackEvent = vi.fn()
const mockConsumeAuthRateLimit = vi.fn()
const mockSendToSlack = vi.fn()
const afterCallbacks: Array<() => unknown> = []
let requestHeaders: Record<string, string> = {}

vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (name: string) => requestHeaders[name] ?? null,
  }),
}))

vi.mock("@/lib/auth/rate-limit", () => ({
  consumeAuthRateLimit: (...args: unknown[]) =>
    mockConsumeAuthRateLimit(...args),
  consumeAuthRateLimitOutcome: async (...args: unknown[]) =>
    (await mockConsumeAuthRateLimit(...args)) ? "allowed" : "refused",
}))

vi.mock("@/lib/slack/send-to-webhook", () => ({
  default: (...args: unknown[]) => mockSendToSlack(...args),
}))

vi.mock("next/server", () => ({
  after: (callback: () => unknown) => afterCallbacks.push(callback),
}))

vi.mock("@/lib/auth/find-auth-user", () => ({
  findAuthUserByEmail: (...args: unknown[]) => mockFindUser(...args),
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    auth: { admin: { generateLink: mockGenerateLink } },
  }),
}))

vi.mock("@/lib/email/send", () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}))

vi.mock("@/lib/email/templates/sign-in-link", () => ({
  SignInLinkEmail: (props: unknown) => props,
}))

vi.mock("@/lib/recaptcha/verify", () => ({
  verifyRecaptcha: (...args: unknown[]) => mockVerifyRecaptcha(...args),
}))

vi.mock("@/lib/posthog/actions", () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}))

import { sendSignInLink } from "./link-action"

const confirmedUser = {
  id: "user-1",
  email: "user@example.com",
  email_confirmed_at: "2026-01-01T00:00:00Z",
  app_metadata: {},
}

const linkFor = (user: Record<string, unknown>) => ({
  data: { user, properties: { hashed_token: "hashed-abc" } },
  error: null,
})

// The account lookup and the link it then generates.
const withAccount = (user: Record<string, unknown> | null) => {
  mockFindUser.mockResolvedValue(user)
  mockGenerateLink.mockResolvedValue(
    user
      ? linkFor(user)
      : {
          data: { user: null, properties: null },
          error: { status: 404, code: "user_not_found", message: "not found" },
        },
  )
}

const runAfter = async () => {
  const callbacks = afterCallbacks.splice(0)
  for (const callback of callbacks) await callback()
}

describe("sendSignInLink", () => {
  beforeEach(() => {
    afterCallbacks.length = 0
    mockGenerateLink.mockReset()
    mockFindUser.mockReset()
    mockSendEmail.mockReset().mockResolvedValue({ success: true })
    mockVerifyRecaptcha.mockReset().mockResolvedValue({
      verified: true,
      providerOutcome: "success",
    })
    mockTrackEvent.mockReset().mockResolvedValue(undefined)
    mockConsumeAuthRateLimit.mockReset().mockResolvedValue(true)
    mockSendToSlack.mockReset().mockResolvedValue({ success: true })
    requestHeaders = {}
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://console.example.com")
  })

  it("rejects a failed captcha before any lookup", async () => {
    mockVerifyRecaptcha.mockResolvedValue({
      verified: false,
      providerOutcome: "rejected",
      reason: "low_score",
    })

    const result = await sendSignInLink("user@example.com", "token")

    expect(result).toEqual({ success: false, errorCode: "captcha_failed" })
    expect(mockVerifyRecaptcha).toHaveBeenCalledWith("token", "signin_link")
    expect(afterCallbacks).toHaveLength(0)
    expect(mockGenerateLink).not.toHaveBeenCalled()
  })

  it("does not send when the captcha provider is unavailable", async () => {
    mockVerifyRecaptcha.mockResolvedValue({
      verified: true,
      providerOutcome: "unavailable",
    })

    const result = await sendSignInLink("user@example.com", "any-token")

    expect(result).toEqual({ success: false, errorCode: "captcha_unavailable" })
    expect(afterCallbacks).toHaveLength(0)
    expect(mockGenerateLink).not.toHaveBeenCalled()
  })

  it("sends when the captcha integration is not configured", async () => {
    mockVerifyRecaptcha.mockResolvedValue({
      verified: true,
      providerOutcome: "unconfigured",
    })

    const result = await sendSignInLink("user@example.com", undefined)

    expect(result).toEqual({ success: true })
    expect(afterCallbacks).toHaveLength(1)
  })

  it.each([
    ["unknown", null],
    ["unconfirmed", { ...confirmedUser, email_confirmed_at: null }],
    [
      "in review",
      { ...confirmedUser, app_metadata: { signup_review: "pending" } },
    ],
    ["confirmed", confirmedUser],
  ])(
    "returns the same result for an %s address before any lookup",
    async (_label, user) => {
      withAccount(user)

      const result = await sendSignInLink("user@example.com", "token")

      expect(result).toEqual({ success: true })
      // The account lookup has not started when the response is returned.
      expect(mockFindUser).not.toHaveBeenCalled()
      expect(afterCallbacks).toHaveLength(1)
      await runAfter()
      expect(mockFindUser).toHaveBeenCalledExactlyOnceWith("user@example.com")
    },
  )

  it("returns success for an invalid email without scheduling a lookup", async () => {
    const result = await sendSignInLink("not-an-email", "token")

    expect(result).toEqual({ success: true })
    expect(afterCallbacks).toHaveLength(0)
  })

  it("emails a confirmed account a magic-link callback URL", async () => {
    withAccount(confirmedUser)

    await sendSignInLink("user@example.com", "token", "/sandboxes")
    await runAfter()

    expect(mockGenerateLink).toHaveBeenCalledWith(
      expect.objectContaining({ type: "recovery", email: "user@example.com" }),
    )
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    const { to, react } = mockSendEmail.mock.calls[0][0]
    expect(to).toBe("user@example.com")
    const url = new URL(react.signInUrl)
    expect(url.origin + url.pathname).toBe(
      "https://console.example.com/auth/callback",
    )
    expect(url.searchParams.get("token_hash")).toBe("hashed-abc")
    // Verified as a magic link so the callback signs in instead of opening
    // the reset-password page.
    expect(url.searchParams.get("type")).toBe("magiclink")
    expect(url.searchParams.get("sign_in_recovery")).toBe("email_link")
    expect(url.searchParams.get("next")).toBe("/sandboxes")
    expect(mockTrackEvent).toHaveBeenCalledWith(
      "auth_sign_in_link_sent",
      "user-1",
      { method: "email_link" },
    )
  })

  it.each([
    "/billing/pro/",
    "/auth/choose-plan/?reason=upgrade&offer=pro_monthly&team=team-1",
  ])("keeps the sign-in destination %s", async (next) => {
    withAccount(confirmedUser)

    await sendSignInLink("user@example.com", "token", next)
    await runAfter()

    const url = new URL(mockSendEmail.mock.calls[0][0].react.signInUrl)
    expect(url.searchParams.get("next")).toBe(next)
  })

  it.each([
    "/auth/reset-password",
    "/auth/choose-plan/?reason=upgrade&redirect=https://evil.example.com",
    "//evil.example.com",
    "https://evil.example.com",
    "/",
  ])("drops the unsafe or default next path %s", async (next) => {
    withAccount(confirmedUser)

    await sendSignInLink("user@example.com", "token", next)
    await runAfter()

    const url = new URL(mockSendEmail.mock.calls[0][0].react.signInUrl)
    expect(url.searchParams.has("next")).toBe(false)
  })

  it.each([
    ["unconfirmed", { email_confirmed_at: null }],
    ["in review", { app_metadata: { signup_review: "pending" } }],
    ["rejected", { app_metadata: { signup_review: "rejected" } }],
    [
      "unconfirmed rejected",
      { email_confirmed_at: null, app_metadata: { signup_review: "rejected" } },
    ],
    ["banned", { banned_until: "2999-01-01T00:00:00Z" }],
    [
      "unconfirmed approved but banned",
      {
        email_confirmed_at: null,
        app_metadata: { signup_review: "approved" },
        banned_until: "2999-01-01T00:00:00Z",
      },
    ],
  ])("sends nothing to an %s account", async (_label, overrides) => {
    withAccount({ ...confirmedUser, ...overrides })

    await sendSignInLink("user@example.com", "token")
    await runAfter()

    // No new token, so a link the account already has keeps working.
    expect(mockGenerateLink).not.toHaveBeenCalled()
    expect(mockSendEmail).not.toHaveBeenCalled()
    expect(mockTrackEvent).toHaveBeenCalledWith(
      "auth_sign_in_link_failed",
      "user-1",
      { method: "email_link", reason: "not_eligible" },
    )
  })

  it("replaces the approval link of an approved but unconfirmed account", async () => {
    // The recovery token replaces the confirming magic link from the staff
    // approval email, so the account must get this link instead.
    withAccount({
      ...confirmedUser,
      email_confirmed_at: null,
      app_metadata: { signup_review: "approved" },
    })

    await sendSignInLink("user@example.com", "token")
    await runAfter()

    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    const url = new URL(mockSendEmail.mock.calls[0][0].react.signInUrl)
    expect(url.searchParams.get("type")).toBe("magiclink")
    expect(mockTrackEvent).toHaveBeenCalledWith(
      "auth_sign_in_link_sent",
      "user-1",
      { method: "email_link" },
    )
  })

  it("sends nothing to an unknown address and tracks it without the email", async () => {
    withAccount(null)

    await sendSignInLink("nobody@example.com", "token")
    await runAfter()

    expect(mockSendEmail).not.toHaveBeenCalled()
    expect(mockTrackEvent).toHaveBeenCalledWith(
      "auth_sign_in_link_failed",
      expect.any(String),
      { method: "email_link", reason: "no_account" },
    )
    expect(JSON.stringify(mockTrackEvent.mock.calls)).not.toContain(
      "nobody@example.com",
    )
  })

  it("tracks a failed send", async () => {
    withAccount(confirmedUser)
    mockSendEmail.mockResolvedValue({ success: false })

    await sendSignInLink("user@example.com", "token")
    await runAfter()

    expect(mockTrackEvent).toHaveBeenCalledWith(
      "auth_sign_in_link_failed",
      "user-1",
      { method: "email_link", reason: "send_failed" },
    )
  })

  it("contains errors thrown after the response", async () => {
    withAccount(confirmedUser)
    mockGenerateLink.mockRejectedValue(new Error("network"))
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

    const result = await sendSignInLink("user@example.com", "token")
    await expect(runAfter()).resolves.toBeUndefined()

    expect(result).toEqual({ success: true })
    consoleError.mockRestore()
  })

  const refuse = (bucket: string) =>
    mockConsumeAuthRateLimit.mockImplementation(
      async (limit: { bucket: string }) => limit.bucket !== bucket,
    )

  it("limits each client IP the same as Supabase Auth, after the response", async () => {
    requestHeaders = { "x-forwarded-for": "203.0.113.7, 10.0.0.1" }
    refuse("signin_link_ip")
    withAccount(confirmedUser)

    const result = await sendSignInLink("user@example.com", "token")
    expect(result).toEqual({ success: true })
    expect(mockConsumeAuthRateLimit).not.toHaveBeenCalled()
    await runAfter()

    expect(mockConsumeAuthRateLimit).toHaveBeenCalledExactlyOnceWith(
      { bucket: "signin_link_ip", max: 30, windowSeconds: 300 },
      "203.0.113.7",
    )
    expect(mockGenerateLink).not.toHaveBeenCalled()
    expect(mockTrackEvent).toHaveBeenCalledWith(
      "auth_sign_in_link_failed",
      expect.any(String),
      { method: "email_link", reason: "rate_limited" },
    )
  })

  it("does not replace a token sent to the same address within a minute", async () => {
    refuse("recovery_email_cooldown")
    withAccount(confirmedUser)

    await sendSignInLink("User@Example.com", "token")
    await runAfter()

    expect(mockConsumeAuthRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ bucket: "recovery_email_cooldown" }),
      "user@example.com",
    )
    expect(mockGenerateLink).not.toHaveBeenCalled()
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it("takes from the hourly email budget only for an eligible account", async () => {
    withAccount(null)

    await sendSignInLink("nobody@example.com", "token")
    await runAfter()

    expect(mockConsumeAuthRateLimit).not.toHaveBeenCalledWith(
      expect.objectContaining({ bucket: "recovery_email_project" }),
      expect.anything(),
    )
  })

  it.each([
    ["recovery_email_ip", "ip_hourly_limit"],
    ["recovery_email_account", "account_hourly_limit"],
  ])(
    "drops the email without using the project budget when %s is used up",
    async (bucket, reason) => {
      requestHeaders = { "x-forwarded-for": "203.0.113.7" }
      refuse(bucket)
      withAccount(confirmedUser)

      await sendSignInLink("user@example.com", "token")
      await runAfter()

      expect(mockConsumeAuthRateLimit).not.toHaveBeenCalledWith(
        expect.objectContaining({ bucket: "recovery_email_project" }),
        expect.anything(),
      )
      expect(mockGenerateLink).not.toHaveBeenCalled()
      expect(mockTrackEvent).toHaveBeenCalledWith(
        "auth_sign_in_link_failed",
        "user-1",
        { method: "email_link", reason },
      )
    },
  )

  it("does not start another address's cooldown once the caller's network limit is used up", async () => {
    requestHeaders = { "x-forwarded-for": "203.0.113.7" }
    refuse("recovery_email_ip")
    withAccount(confirmedUser)

    await sendSignInLink("victim@example.com", "token")
    await runAfter()

    expect(mockConsumeAuthRateLimit).not.toHaveBeenCalledWith(
      expect.objectContaining({ bucket: "recovery_email_cooldown" }),
      expect.anything(),
    )
    expect(mockGenerateLink).not.toHaveBeenCalled()
  })

  it("starts no cooldown for an address with no account", async () => {
    withAccount(null)

    await sendSignInLink("nobody@example.com", "token")
    await runAfter()

    expect(mockConsumeAuthRateLimit).not.toHaveBeenCalledWith(
      expect.objectContaining({ bucket: "recovery_email_cooldown" }),
      expect.anything(),
    )
  })

  it("shares the hourly network and account limits with password reset", async () => {
    requestHeaders = { "x-forwarded-for": "203.0.113.7" }
    withAccount(confirmedUser)

    await sendSignInLink("user@example.com", "token")
    await runAfter()

    expect(mockConsumeAuthRateLimit).toHaveBeenCalledWith(
      { bucket: "recovery_email_ip", max: 10, windowSeconds: 3600 },
      "203.0.113.7",
    )
    expect(mockConsumeAuthRateLimit).toHaveBeenCalledWith(
      { bucket: "recovery_email_account", max: 5, windowSeconds: 3600 },
      "user-1",
    )
  })

  it("drops the email once the hourly email budget is used up", async () => {
    vi.useFakeTimers()
    try {
      refuse("recovery_email_project")
      withAccount(confirmedUser)
      vi.spyOn(console, "error").mockImplementation(() => {})

      await sendSignInLink("user@example.com", "token")
      const pending = runAfter()
      await vi.runAllTimersAsync()
      await pending

      // No new token, so a link the account already has keeps working.
      expect(mockGenerateLink).not.toHaveBeenCalled()
      expect(mockSendEmail).not.toHaveBeenCalled()
      expect(mockTrackEvent).toHaveBeenCalledWith(
        "auth_sign_in_link_failed",
        "user-1",
        { method: "email_link", reason: "email_budget" },
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it("sends nothing and creates no token when the account lookup fails", async () => {
    withAccount(confirmedUser)
    mockFindUser.mockRejectedValue(new Error("lookup failed"))
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

    await sendSignInLink("user@example.com", "token")
    await runAfter()

    expect(mockGenerateLink).not.toHaveBeenCalled()
    expect(mockSendEmail).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it("tracks a failed link generation", async () => {
    withAccount(confirmedUser)
    mockGenerateLink.mockResolvedValue({
      data: null,
      error: { status: 500, message: "boom" },
    })
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

    await sendSignInLink("user@example.com", "token")
    await runAfter()

    expect(mockSendEmail).not.toHaveBeenCalled()
    expect(mockTrackEvent).toHaveBeenCalledWith(
      "auth_sign_in_link_failed",
      "user-1",
      { method: "email_link", reason: "generate_failed" },
    )
    consoleError.mockRestore()
  })
})
