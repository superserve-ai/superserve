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
const mockProvision = vi.fn()
vi.mock("@/lib/api/team-provisioning", () => ({
  provisionHeldApplicantTeam: (...args: unknown[]) => mockProvision(...args),
}))
const mockAssign = vi.fn()
const TEAM = { id: "team-1", name: "applicant@example.com", region: "use" }
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
    mockProvision.mockReset().mockResolvedValue(TEAM)
    mockAssign.mockReset().mockResolvedValue(undefined)
  })

  it("provisions the team, assigns Enterprise, then lifts the hold and emails", async () => {
    mockGetUserById.mockResolvedValue({ data: { user: user() }, error: null })

    await expect(
      approveSignup(USER_ID, "staff-1", mockAssign),
    ).resolves.toEqual({ ok: true, outcome: "approved" })

    expect(mockAssign).toHaveBeenCalledWith(TEAM)
    expect(mockUpdate).toHaveBeenNthCalledWith(
      1,
      USER_ID,
      expect.objectContaining({
        signup_review: "approved",
        approved_by: "staff-1",
        approved_team_id: "team-1",
      }),
    )
    const order = [
      mockProvision.mock.invocationCallOrder[0],
      mockAssign.mock.invocationCallOrder[0],
      mockUpdate.mock.invocationCallOrder[0],
      mockSendEmail.mock.invocationCallOrder[0],
    ]
    expect(order).toEqual([...order].toSorted((a, b) => a - b))
    expect(mockUpdate).toHaveBeenLastCalledWith(
      USER_ID,
      expect.objectContaining({ approval_email_sent_at: expect.any(String) }),
    )
    expect(mockGenerateLink).not.toHaveBeenCalled()
  })

  it("keeps the hold when the plan can't be assigned, so a retry finishes", async () => {
    mockGetUserById.mockResolvedValue({ data: { user: user() }, error: null })
    mockAssign.mockRejectedValueOnce(new Error("unavailable"))

    await expect(
      approveSignup(USER_ID, "staff-1", mockAssign),
    ).rejects.toThrow()
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockSendEmail).not.toHaveBeenCalled()

    await expect(
      approveSignup(USER_ID, "staff-1", mockAssign),
    ).resolves.toEqual({ ok: true, outcome: "approved" })
    expect(mockProvision).toHaveBeenCalledTimes(2)
    expect(mockAssign).toHaveBeenCalledTimes(2)
  })

  it("resends the email to an approved applicant who never got it", async () => {
    mockGetUserById.mockResolvedValue({
      data: {
        user: user({
          app_metadata: { provider: "email", signup_review: "approved" },
        }),
      },
      error: null,
    })

    await expect(
      approveSignup(USER_ID, "staff-1", mockAssign),
    ).resolves.toEqual({ ok: true, outcome: "approved" })
    expect(mockProvision).not.toHaveBeenCalled()
    expect(mockAssign).not.toHaveBeenCalled()
    expect(mockSendEmail).toHaveBeenCalledOnce()
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

    await approveSignup(USER_ID, "staff-1", mockAssign)

    expect(mockGenerateLink).toHaveBeenCalledWith(
      expect.objectContaining({ type: "magiclink" }),
    )
  })

  it.each([
    [
      "approved and emailed",
      {
        signup_review: "approved",
        approval_email_sent_at: "2026-10-01T00:00:00Z",
      },
    ],
    ["rejected", { signup_review: "rejected" }],
    ["unmarked", {}],
  ])("leaves an account that is %s alone", async (_label, app_metadata) => {
    mockGetUserById.mockResolvedValue({
      data: { user: user({ app_metadata }) },
      error: null,
    })
    expect((await approveSignup(USER_ID, "staff-1", mockAssign)).ok).toBe(false)
    expect((await rejectSignup(USER_ID, "staff-1")).ok).toBe(false)
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockSendEmail).not.toHaveBeenCalled()
    expect(mockProvision).not.toHaveBeenCalled()
  })

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
