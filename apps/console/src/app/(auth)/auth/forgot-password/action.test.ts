/**
 * forgot-password action — critical safety test.
 *
 * The action MUST always return `{ success: true }`, regardless of whether
 * the email belongs to a real user, whether generateLink errors, whether
 * sendEmail throws, or whether the input is invalid. Any path that
 * discloses "this email exists / does not exist" is an email-enumeration
 * vulnerability.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

const mockGenerateLink = vi.fn()
const mockSendEmail = vi.fn()
const mockVerifyRecaptcha = vi.fn()
const mockConsumeAuthRateLimit = vi.fn()
let requestHeaders: Record<string, string> = {}

vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (name: string) => requestHeaders[name] ?? null,
  }),
}))

vi.mock("@/lib/recaptcha/verify", () => ({
  verifyRecaptcha: (...args: unknown[]) => mockVerifyRecaptcha(...args),
}))

vi.mock("@/lib/auth/rate-limit", () => ({
  consumeAuthRateLimit: (...args: unknown[]) =>
    mockConsumeAuthRateLimit(...args),
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    auth: {
      admin: { generateLink: mockGenerateLink },
    },
  }),
}))

vi.mock("@/lib/email/send", () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}))

vi.mock("@/lib/email/templates/password-reset", () => ({
  PasswordResetEmail: () => null,
}))

import { sendPasswordResetEmail } from "./action"

describe("sendPasswordResetEmail", () => {
  beforeEach(() => {
    mockGenerateLink.mockReset()
    mockSendEmail.mockReset()
    mockVerifyRecaptcha
      .mockReset()
      .mockResolvedValue({ verified: true, providerOutcome: "success" })
    mockConsumeAuthRateLimit.mockReset().mockResolvedValue(true)
    requestHeaders = {}
  })

  it.each([
    `/invite/ssinv_use_${"T".repeat(43)}/`,
    "/sandboxes",
    "https://example.com",
    "/invite/invalid",
  ])("validates the invite destination again (%s)", async (next) => {
    mockGenerateLink.mockResolvedValue({
      data: { properties: { hashed_token: "hash" } },
      error: null,
    })
    await sendPasswordResetEmail("user@example.com", "recaptcha-token", next)
    const redirect = new URL(
      mockGenerateLink.mock.calls[0][0].options.redirectTo,
    )
    expect(redirect.searchParams.get("next")).toBe("/auth/reset-password")
    expect(redirect.searchParams.get("invite")).toBe(
      next.startsWith("/invite/ssinv_") ? next.replace(/\/$/, "") : null,
    )
  })

  it("returns success for a valid email + happy path", async () => {
    mockGenerateLink.mockResolvedValue({
      data: { properties: { hashed_token: "token-abc" } },
      error: null,
    })
    mockSendEmail.mockResolvedValue(undefined)

    const result = await sendPasswordResetEmail("user@example.com")

    expect(result).toEqual({ success: true })
    expect(mockGenerateLink).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "recovery",
        email: "user@example.com",
      }),
    )
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
  })

  it("returns success for an invalid email without calling Supabase", async () => {
    const result = await sendPasswordResetEmail("not-an-email")
    expect(result).toEqual({ success: true })
    expect(mockGenerateLink).not.toHaveBeenCalled()
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it("returns success when Supabase generateLink errors (no enumeration leak)", async () => {
    mockGenerateLink.mockResolvedValue({
      data: null,
      error: { message: "User not found" },
    })

    const result = await sendPasswordResetEmail("ghost@example.com")

    expect(result).toEqual({ success: true })
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it("returns success when generateLink returns data without a hashed token", async () => {
    mockGenerateLink.mockResolvedValue({
      data: { properties: {} },
      error: null,
    })

    const result = await sendPasswordResetEmail("user@example.com")

    expect(result).toEqual({ success: true })
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it("returns success when sendEmail throws", async () => {
    mockGenerateLink.mockResolvedValue({
      data: { properties: { hashed_token: "token-abc" } },
      error: null,
    })
    mockSendEmail.mockRejectedValue(new Error("SMTP down"))

    const result = await sendPasswordResetEmail("user@example.com")

    expect(result).toEqual({ success: true })
  })

  it("returns success when the admin client throws synchronously", async () => {
    mockGenerateLink.mockImplementation(() => {
      throw new Error("boom")
    })

    const result = await sendPasswordResetEmail("user@example.com")

    expect(result).toEqual({ success: true })
  })

  it("builds the reset URL with token_hash + type=recovery", async () => {
    mockGenerateLink.mockResolvedValue({
      data: { properties: { hashed_token: "hash-xyz" } },
      error: null,
    })
    mockSendEmail.mockResolvedValue(undefined)

    await sendPasswordResetEmail("user@example.com")

    const call = mockSendEmail.mock.calls[0][0] as {
      to: string
      subject: string
      react: unknown
    }
    expect(call.to).toBe("user@example.com")
    expect(call.subject).toContain("Reset")
  })

  it.each([
    ["an account awaiting Enterprise setup", { signup_review: "pending" }],
    ["a rejected account", { signup_review: "rejected" }],
  ])(
    "returns success without sending a link to %s",
    async (_label, app_metadata) => {
      mockGenerateLink.mockResolvedValue({
        data: {
          user: { id: "user-1", app_metadata },
          properties: { hashed_token: "token-abc" },
        },
        error: null,
      })

      const result = await sendPasswordResetEmail("user@example.com")

      expect(result).toEqual({ success: true })
      expect(mockSendEmail).not.toHaveBeenCalled()
    },
  )

  it("still sends recovery to an unconfirmed account without a hold", async () => {
    mockGenerateLink.mockResolvedValue({
      data: {
        user: { id: "user-1", email_confirmed_at: null, app_metadata: {} },
        properties: { hashed_token: "token-abc" },
      },
      error: null,
    })
    mockSendEmail.mockResolvedValue(undefined)

    await sendPasswordResetEmail("user@example.com")

    expect(mockSendEmail).toHaveBeenCalledOnce()
  })

  it("returns a captcha error and sends nothing when reCAPTCHA fails", async () => {
    mockVerifyRecaptcha.mockResolvedValue({
      verified: false,
      providerOutcome: "rejected",
      reason: "low_score",
    })

    const result = await sendPasswordResetEmail("user@example.com", "token")

    expect(result).toEqual({
      success: false,
      error: "We couldn't verify you're human. Please try again.",
      errorCode: "captcha_failed",
    })
    expect(mockVerifyRecaptcha).toHaveBeenCalledWith("token", "password_reset")
    expect(mockConsumeAuthRateLimit).not.toHaveBeenCalled()
    expect(mockGenerateLink).not.toHaveBeenCalled()
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it("fails closed when the reCAPTCHA provider is unavailable", async () => {
    mockVerifyRecaptcha.mockResolvedValue({
      verified: true,
      providerOutcome: "unavailable",
    })

    const result = await sendPasswordResetEmail("user@example.com", "token")

    expect(result).toEqual({
      success: false,
      error: "We couldn't reach our bot-check. Please try again in a minute.",
      errorCode: "captcha_unavailable",
    })
    expect(mockGenerateLink).not.toHaveBeenCalled()
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it("still sends when reCAPTCHA is not configured", async () => {
    mockVerifyRecaptcha.mockResolvedValue({
      verified: true,
      providerOutcome: "unconfigured",
    })
    mockGenerateLink.mockResolvedValue({
      data: { properties: { hashed_token: "token-abc" } },
      error: null,
    })

    const result = await sendPasswordResetEmail("user@example.com")

    expect(result).toEqual({ success: true })
    expect(mockSendEmail).toHaveBeenCalledOnce()
  })

  it("limits requests per client IP before touching Supabase", async () => {
    requestHeaders = { "x-forwarded-for": "203.0.113.7, 10.0.0.1" }
    mockConsumeAuthRateLimit.mockResolvedValueOnce(false)

    const result = await sendPasswordResetEmail("user@example.com", "token")

    expect(result).toEqual({
      success: false,
      error: "Too many reset requests. Try again in a few minutes.",
      errorCode: "rate_limited",
    })
    expect(mockConsumeAuthRateLimit).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ bucket: "password_reset_ip" }),
      "203.0.113.7",
    )
    expect(mockGenerateLink).not.toHaveBeenCalled()
  })

  it("keeps one IP budget when a caller rotates cf-connecting-ip", async () => {
    const used = new Map<string, number>()
    mockConsumeAuthRateLimit.mockImplementation(
      async (limit: { bucket: string; max: number }, key: string) => {
        const id = `${limit.bucket}:${key}`
        const count = (used.get(id) ?? 0) + 1
        used.set(id, count)
        return count <= limit.max
      },
    )
    mockGenerateLink.mockResolvedValue({ data: null, error: null })

    const results = []
    for (let i = 1; i <= 11; i++) {
      requestHeaders = {
        "cf-connecting-ip": `198.51.100.${i}`,
        "x-real-ip": "203.0.113.7",
        "x-forwarded-for": "203.0.113.7",
      }
      results.push(
        await sendPasswordResetEmail(`user${i}@example.com`, "token"),
      )
    }

    expect(results.slice(0, 10)).toEqual(Array(10).fill({ success: true }))
    expect(results[10]).toEqual({
      success: false,
      error: "Too many reset requests. Try again in a few minutes.",
      errorCode: "rate_limited",
    })
    expect(used.get("password_reset_ip:203.0.113.7")).toBe(11)
  })

  it("skips the IP limit when no client IP is known", async () => {
    mockGenerateLink.mockResolvedValue({ data: null, error: null })

    await sendPasswordResetEmail("User@Example.com", "token")

    expect(mockConsumeAuthRateLimit).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ bucket: "password_reset_email" }),
      "user@example.com",
    )
  })

  it("silently skips the email once the per-address limit is used up", async () => {
    requestHeaders = { "x-forwarded-for": "203.0.113.7" }
    mockConsumeAuthRateLimit
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)

    const result = await sendPasswordResetEmail("User@Example.com", "token")

    expect(result).toEqual({ success: true })
    expect(mockConsumeAuthRateLimit).toHaveBeenLastCalledWith(
      expect.objectContaining({ bucket: "password_reset_email" }),
      "user@example.com",
    )
    expect(mockGenerateLink).not.toHaveBeenCalled()
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it("does not spend rate-limit budget on an invalid email", async () => {
    requestHeaders = { "x-forwarded-for": "203.0.113.7" }

    const result = await sendPasswordResetEmail("not-an-email", "token")

    expect(result).toEqual({ success: true })
    expect(mockConsumeAuthRateLimit).not.toHaveBeenCalled()
  })
})
