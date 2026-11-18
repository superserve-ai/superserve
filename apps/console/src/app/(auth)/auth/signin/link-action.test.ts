/**
 * sign-in link action — the response must not reveal whether an address
 * belongs to an account. Every lookup and send runs in `after()`, so the
 * result is decided before any of that work starts.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

const mockGenerateLink = vi.fn()
const mockSendEmail = vi.fn()
const mockVerifyRecaptcha = vi.fn()
const mockTrackEvent = vi.fn()
const afterCallbacks: Array<() => unknown> = []

vi.mock("next/server", () => ({
  after: (callback: () => unknown) => afterCallbacks.push(callback),
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

const runAfter = async () => {
  const callbacks = afterCallbacks.splice(0)
  for (const callback of callbacks) await callback()
}

describe("sendSignInLink", () => {
  beforeEach(() => {
    afterCallbacks.length = 0
    mockGenerateLink.mockReset()
    mockSendEmail.mockReset().mockResolvedValue({ success: true })
    mockVerifyRecaptcha.mockReset().mockResolvedValue({
      verified: true,
      providerOutcome: "success",
    })
    mockTrackEvent.mockReset().mockResolvedValue(undefined)
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
    [
      "unknown",
      {
        data: { user: null, properties: null },
        error: { status: 404, code: "user_not_found", message: "not found" },
      },
    ],
    ["unconfirmed", linkFor({ ...confirmedUser, email_confirmed_at: null })],
    [
      "in review",
      linkFor({ ...confirmedUser, app_metadata: { signup_review: "pending" } }),
    ],
    ["confirmed", linkFor(confirmedUser)],
  ])(
    "returns the same result for an %s address before any lookup",
    async (_label, link) => {
      mockGenerateLink.mockResolvedValue(link)

      const result = await sendSignInLink("user@example.com", "token")

      expect(result).toEqual({ success: true })
      // The account lookup has not started when the response is returned.
      expect(mockGenerateLink).not.toHaveBeenCalled()
      expect(afterCallbacks).toHaveLength(1)
      await runAfter()
      expect(mockGenerateLink).toHaveBeenCalledTimes(1)
    },
  )

  it("returns success for an invalid email without scheduling a lookup", async () => {
    const result = await sendSignInLink("not-an-email", "token")

    expect(result).toEqual({ success: true })
    expect(afterCallbacks).toHaveLength(0)
  })

  it("emails a confirmed account a magic-link callback URL", async () => {
    mockGenerateLink.mockResolvedValue(linkFor(confirmedUser))

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
    mockGenerateLink.mockResolvedValue(linkFor(confirmedUser))

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
    mockGenerateLink.mockResolvedValue(linkFor(confirmedUser))

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
    mockGenerateLink.mockResolvedValue(
      linkFor({ ...confirmedUser, ...overrides }),
    )

    await sendSignInLink("user@example.com", "token")
    await runAfter()

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
    mockGenerateLink.mockResolvedValue(
      linkFor({
        ...confirmedUser,
        email_confirmed_at: null,
        app_metadata: { signup_review: "approved" },
      }),
    )

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
    mockGenerateLink.mockResolvedValue({
      data: { user: null, properties: null },
      error: { status: 404, code: "user_not_found", message: "not found" },
    })

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
    mockGenerateLink.mockResolvedValue(linkFor(confirmedUser))
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
    mockGenerateLink.mockRejectedValue(new Error("network"))
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

    const result = await sendSignInLink("user@example.com", "token")
    await expect(runAfter()).resolves.toBeUndefined()

    expect(result).toEqual({ success: true })
    consoleError.mockRestore()
  })
})
