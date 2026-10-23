import { beforeEach, describe, expect, it, vi } from "vitest"

const mockGetUserById = vi.fn()
const mockGenerateLink = vi.fn()
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    auth: {
      admin: {
        getUserById: (...args: unknown[]) => mockGetUserById(...args),
        generateLink: (...args: unknown[]) => mockGenerateLink(...args),
      },
    },
  }),
}))
const mockUpdate = vi.fn()
vi.mock("@/lib/auth/signup-review-server", () => ({
  updateSignupReviewMetadata: (...args: unknown[]) => mockUpdate(...args),
}))
const mockSendEmail = vi.fn()
vi.mock("@/lib/email/send", () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}))

import { approveSignup, rejectSignup } from "./signup-approval"

const USER_ID = "11111111-1111-4111-8111-111111111111"

function user(overrides: Record<string, unknown> = {}) {
  return {
    id: USER_ID,
    email: "applicant@example.com",
    email_confirmed_at: "2026-10-01T00:00:00Z",
    created_at: "2026-10-01T00:00:00Z",
    app_metadata: { provider: "email", signup_review: "pending" },
    user_metadata: {},
    ...overrides,
  }
}

describe("signup approval", () => {
  beforeEach(() => {
    mockGetUserById.mockReset()
    mockGenerateLink.mockReset()
    mockUpdate.mockReset().mockResolvedValue(undefined)
    mockSendEmail.mockReset().mockResolvedValue({ success: true })
  })

  it("records access before emailing a sign-in link", async () => {
    mockGetUserById.mockResolvedValue({ data: { user: user() }, error: null })

    await expect(approveSignup(USER_ID, "staff-1")).resolves.toEqual({
      ok: true,
      outcome: "approved",
    })

    expect(mockUpdate).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({
        signup_review: "approved",
        approved_by: "staff-1",
      }),
    )
    expect(mockUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      mockSendEmail.mock.invocationCallOrder[0],
    )
    expect(mockGenerateLink).not.toHaveBeenCalled()
  })

  it("sends an unconfirmed applicant a link that confirms the address", async () => {
    mockGetUserById.mockResolvedValue({
      data: { user: user({ email_confirmed_at: null }) },
      error: null,
    })
    mockGenerateLink.mockResolvedValue({
      data: { properties: { hashed_token: "hash" } },
      error: null,
    })

    await approveSignup(USER_ID, "staff-1")

    expect(mockGenerateLink).toHaveBeenCalledWith(
      expect.objectContaining({ type: "magiclink" }),
    )
  })

  it.each(["approved", "rejected", undefined])(
    "leaves an account that is not pending alone (%s)",
    async (status) => {
      mockGetUserById.mockResolvedValue({
        data: {
          user: user({
            app_metadata: status ? { signup_review: status } : {},
          }),
        },
        error: null,
      })
      expect((await approveSignup(USER_ID, "staff-1")).ok).toBe(false)
      expect((await rejectSignup(USER_ID, "staff-1")).ok).toBe(false)
      expect(mockUpdate).not.toHaveBeenCalled()
      expect(mockSendEmail).not.toHaveBeenCalled()
    },
  )

  it("rejects a pending applicant without emailing", async () => {
    mockGetUserById.mockResolvedValue({ data: { user: user() }, error: null })
    await expect(rejectSignup(USER_ID, "staff-1")).resolves.toEqual({
      ok: true,
      outcome: "rejected",
    })
    expect(mockUpdate).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ signup_review: "rejected" }),
    )
    expect(mockSendEmail).not.toHaveBeenCalled()
  })
})
