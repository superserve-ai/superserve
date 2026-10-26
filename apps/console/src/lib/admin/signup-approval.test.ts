import { beforeEach, describe, expect, it, vi } from "vitest"

const mockGetUserById = vi.fn()
const mockGenerateLink = vi.fn()
const mockCatalog = vi.fn()
vi.mock("./enterprise-plan", () => ({
  listEnterprisePlanVersions: (...args: unknown[]) => mockCatalog(...args),
}))
const mockClaim = vi.fn()
const mockReadDecision = vi.fn()
let decision: Record<string, unknown> | null = null
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      upsert: (...args: unknown[]) => mockClaim(...args),
      select: () => ({ eq: () => ({ maybeSingle: () => mockReadDecision() }) }),
    }),
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

const PLAN = "22222222-2222-4222-8222-222222222222"
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
    decision = null
    mockCatalog.mockReset().mockResolvedValue([
      { id: PLAN, name: "Enterprise" },
      {
        id: "33333333-3333-4333-8333-333333333333",
        name: "Another Enterprise",
      },
    ])
    mockClaim.mockReset().mockImplementation(async (payload) => {
      decision ??= { ...payload, created_at: "2026-10-26T00:00:00Z" }
      return { error: null }
    })
    mockReadDecision
      .mockReset()
      .mockImplementation(async () => ({ data: decision, error: null }))
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
      approveSignup(USER_ID, "staff-1", PLAN, mockAssign),
    ).resolves.toEqual({ ok: true, outcome: "approved" })

    expect(mockAssign).toHaveBeenCalledWith(TEAM, PLAN)
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
      approveSignup(USER_ID, "staff-1", PLAN, mockAssign),
    ).rejects.toThrow()
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockSendEmail).not.toHaveBeenCalled()

    await expect(
      approveSignup(USER_ID, "staff-1", PLAN, mockAssign),
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
      approveSignup(USER_ID, "staff-1", PLAN, mockAssign),
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

    await approveSignup(USER_ID, "staff-1", PLAN, mockAssign)

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
    expect((await approveSignup(USER_ID, "staff-1", PLAN, mockAssign)).ok).toBe(
      false,
    )
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
  it.each(["approved", "rejected"])(
    "serializes concurrent opposing decisions when %s wins",
    async (first) => {
      mockGetUserById.mockResolvedValue({ data: { user: user() }, error: null })
      const approve = () => approveSignup(USER_ID, "approver", PLAN, mockAssign)
      const reject = () => rejectSignup(USER_ID, "rejecter")
      let claimed!: () => void
      const firstClaimed = new Promise<void>((resolve) => {
        claimed = resolve
      })
      mockClaim.mockImplementation(async (payload) => {
        decision ??= { ...payload, created_at: "2026-10-26T00:00:00Z" }
        claimed()
        return { error: null }
      })
      const firstRequest = first === "approved" ? approve() : reject()
      await firstClaimed
      const results = await Promise.all([
        firstRequest,
        first === "approved" ? reject() : approve(),
      ])
      expect(results[0].ok).toBe(true)
      expect(results[1].ok).toBe(false)
      expect(decision?.decision).toBe(first)
      expect(mockProvision).toHaveBeenCalledTimes(first === "approved" ? 1 : 0)
      expect(mockAssign).toHaveBeenCalledTimes(first === "approved" ? 1 : 0)
      expect(
        mockUpdate.mock.calls
          .filter(([, patch]) => patch.signup_review)
          .map(([, patch]) => patch.signup_review),
      ).toEqual([first])
    },
  )

  it("rejects competing plan selections before the losing request provisions", async () => {
    mockGetUserById.mockResolvedValue({ data: { user: user() }, error: null })
    const results = await Promise.all([
      approveSignup(USER_ID, "first-staff", PLAN, mockAssign),
      approveSignup(
        USER_ID,
        "other-staff",
        "33333333-3333-4333-8333-333333333333",
        mockAssign,
      ),
    ])
    expect(results.map((r) => r.ok)).toEqual([true, false])
    expect(mockAssign).toHaveBeenCalledOnce()
    expect(mockAssign).toHaveBeenCalledWith(TEAM, PLAN)
  })

  it("retries the winning frozen region, plan and staff after a partial failure", async () => {
    mockGetUserById.mockResolvedValue({ data: { user: user() }, error: null })
    decision = {
      user_id: USER_ID,
      decision: "approved",
      staff_id: "original-staff",
      plan_version_id: PLAN,
      region: "usw",
      created_at: "2026-10-25T00:00:00Z",
    }
    mockAssign.mockRejectedValueOnce(new Error("temporary failure"))
    await expect(
      approveSignup(USER_ID, "new-staff", PLAN, mockAssign),
    ).rejects.toThrow("temporary failure")
    await approveSignup(USER_ID, "new-staff", PLAN, mockAssign)
    expect(mockCatalog).not.toHaveBeenCalled()
    expect(mockProvision).toHaveBeenCalledWith(expect.anything(), "usw", PLAN)
    expect(mockAssign).toHaveBeenLastCalledWith(TEAM, PLAN)
    expect(mockUpdate).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({
        approved_by: "original-staff",
        approved_at: "2026-10-25T00:00:00Z",
      }),
    )
  })

  it.each(["claim", "read"])(
    "fails closed on decision %s storage errors",
    async (stage) => {
      mockGetUserById.mockResolvedValue({ data: { user: user() }, error: null })
      if (stage === "claim")
        mockClaim.mockResolvedValue({ error: { message: "missing schema" } })
      else
        mockReadDecision.mockResolvedValue({
          data: null,
          error: { message: "unavailable" },
        })
      await expect(
        approveSignup(USER_ID, "staff-1", PLAN, mockAssign),
      ).rejects.toThrow()
      await expect(rejectSignup(USER_ID, "staff-1")).rejects.toThrow()
      expect(mockProvision).not.toHaveBeenCalled()
      expect(mockUpdate).not.toHaveBeenCalled()
      expect(mockSendEmail).not.toHaveBeenCalled()
    },
  )

  it("requires a plan before recording or provisioning a pending approval", async () => {
    mockGetUserById.mockResolvedValue({ data: { user: user() }, error: null })
    expect((await approveSignup(USER_ID, "staff-1", "", mockAssign)).ok).toBe(
      false,
    )
    expect(mockClaim).not.toHaveBeenCalled()
    expect(mockProvision).not.toHaveBeenCalled()
  })
  it.each(["unknown", "unavailable"])(
    "refuses a first claim when the plan catalog is %s",
    async (failure) => {
      mockGetUserById.mockResolvedValue({ data: { user: user() }, error: null })
      if (failure === "unknown") {
        mockCatalog.mockResolvedValue([])
        expect(
          (await approveSignup(USER_ID, "staff-1", PLAN, mockAssign)).ok,
        ).toBe(false)
      } else {
        mockCatalog.mockRejectedValue(new Error("unavailable"))
        await expect(
          approveSignup(USER_ID, "staff-1", PLAN, mockAssign),
        ).rejects.toThrow()
      }
      expect(mockClaim).not.toHaveBeenCalled()
      expect(mockProvision).not.toHaveBeenCalled()
      expect(mockUpdate).not.toHaveBeenCalled()
    },
  )
})
