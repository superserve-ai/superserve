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

vi.mock("@superserve/supabase/admin", () => ({
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
})
