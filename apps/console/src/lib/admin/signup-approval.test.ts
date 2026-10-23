import { beforeEach, describe, expect, it, vi } from "vitest"

const mockGetUserById = vi.fn()
const mockGenerateLink = vi.fn()
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    auth: {
      admin: { getUserById: mockGetUserById, generateLink: mockGenerateLink },
    },
  }),
}))
const mockUpdateReview = vi.fn()
vi.mock("@/lib/auth/signup-review-server", () => ({
  updateSignupReviewMetadata: (...args: unknown[]) => mockUpdateReview(...args),
}))
const mockSendEmail = vi.fn()
vi.mock("@/lib/email/send", () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}))
vi.mock("@/lib/email/templates/confirmation", () => ({
  ConfirmationEmail: ({ confirmationUrl }: { confirmationUrl: string }) =>
    confirmationUrl,
}))
vi.mock("@/lib/email/templates/signup-approved", () => ({
  SignupApprovedEmail: (props: unknown) => props,
}))
vi.mock("next/headers", () => ({ cookies: async () => new Map() }))

import { validSignupDeviceBinding } from "@/lib/fingerprint/binding-proof"

import { approveSignup, rejectSignup } from "./signup-approval"

const USER_ID = "8c2f4d1e-3b6a-4f7e-9a0b-1c2d3e4f5a6b"

function emailUser(appMetadata: Record<string, unknown>) {
  return {
    id: USER_ID,
    email: "new-user@example.com",
    created_at: "2026-10-01T00:00:00Z",
    email_confirmed_at: null,
    app_metadata: { provider: "email", ...appMetadata },
    user_metadata: { full_name: "New User" },
  }
}

describe("signup approval", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://console.example.com")
    vi.stubEnv(
      "GOOGLE_SIGNUP_PROOF_SECRET",
      "a-secret-with-at-least-thirty-two-characters",
    )
    mockGetUserById.mockReset()
    mockGenerateLink.mockReset().mockResolvedValue({
      data: { properties: { hashed_token: "fresh-token" } },
      error: null,
    })
    mockUpdateReview.mockReset().mockResolvedValue(undefined)
    mockSendEmail.mockReset().mockResolvedValue({ success: true })
  })

  it("records approval, then mails a fresh link carrying the original signup parameters", async () => {
    mockGetUserById.mockResolvedValue({
      data: {
        user: emailUser({
          signup_review: "pending",
          signup_confirmation: {
            signup_attempt_id: "attempt-1",
            offer: "starter_annual",
            next: "/yc/claim",
            device_attempt_id: "device-1",
          },
        }),
      },
      error: null,
    })

    await expect(approveSignup(USER_ID, "staff-1")).resolves.toEqual({
      ok: true,
      outcome: "approved",
    })

    expect(mockUpdateReview.mock.calls[0]).toEqual([
      USER_ID,
      {
        signup_review: "approved",
        approved_by: "staff-1",
        approved_at: expect.any(String),
      },
    ])
    expect(mockUpdateReview.mock.invocationCallOrder[0]).toBeLessThan(
      mockSendEmail.mock.invocationCallOrder[0],
    )
    expect(mockGenerateLink).toHaveBeenCalledWith({
      type: "magiclink",
      email: "new-user@example.com",
      options: {
        redirectTo:
          "https://console.example.com/auth/callback?next=%2Fyc%2Fclaim&offer=starter_annual",
      },
    })
    const link = new URL(mockSendEmail.mock.lastCall![0].react)
    expect(link.pathname).toBe("/auth/callback")
    expect(Object.fromEntries(link.searchParams)).toMatchObject({
      next: "/yc/claim",
      offer: "starter_annual",
      token_hash: "fresh-token",
      type: "magiclink",
      signup_attempt_id: "attempt-1",
      device_attempt_id: "device-1",
    })
    expect(
      validSignupDeviceBinding(
        USER_ID,
        "device-1",
        link.searchParams.get("device_bind_proof")!,
      ),
    ).toBe(true)
  })

  it("resends to an approved account that has not confirmed, without re-approving it", async () => {
    mockGetUserById.mockResolvedValue({
      data: {
        user: emailUser({
          signup_review: "approved",
          approval_email_sent_at: "2026-10-01T01:00:00Z",
        }),
      },
      error: null,
    })

    await expect(approveSignup(USER_ID, "staff-2")).resolves.toEqual({
      ok: true,
      outcome: "resent",
    })
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    expect(mockUpdateReview).not.toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ signup_review: "approved" }),
    )
  })

  it("refuses to approve an account that already finished approval", async () => {
    mockGetUserById.mockResolvedValue({
      data: {
        user: {
          ...emailUser({
            signup_review: "approved",
            approval_email_sent_at: "2026-10-01T01:00:00Z",
          }),
          email_confirmed_at: "2026-10-01T02:00:00Z",
        },
      },
      error: null,
    })

    await expect(approveSignup(USER_ID, "staff-1")).resolves.toEqual({
      ok: false,
      error: "This account is already approved.",
    })
    expect(mockSendEmail).not.toHaveBeenCalled()
    expect(mockUpdateReview).not.toHaveBeenCalled()
  })

  it("rejects only pending accounts and sends nothing", async () => {
    mockGetUserById.mockResolvedValueOnce({
      data: { user: emailUser({ signup_review: "pending" }) },
      error: null,
    })
    await expect(rejectSignup(USER_ID, "staff-1")).resolves.toEqual({
      ok: true,
      outcome: "rejected",
    })
    expect(mockUpdateReview).toHaveBeenCalledWith(USER_ID, {
      signup_review: "rejected",
      rejected_by: "staff-1",
      rejected_at: expect.any(String),
    })

    mockGetUserById.mockResolvedValueOnce({
      data: { user: emailUser({}) },
      error: null,
    })
    await expect(rejectSignup(USER_ID, "staff-1")).resolves.toMatchObject({
      ok: false,
    })
    expect(mockSendEmail).not.toHaveBeenCalled()
  })
})
