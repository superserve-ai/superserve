import { beforeEach, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({
  impersonation: vi.fn(),
  approve: vi.fn(),
  reject: vi.fn(),
  assign: vi.fn(),
  allowed: true,
  billing: true,
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "operator" } } }) },
  }),
}))
vi.mock("./impersonation", () => ({
  getImpersonationTeamId: mocks.impersonation,
}))
vi.mock("./permissions", () => ({
  canApprovePlatformSignups: () => mocks.allowed,
  canWriteAdminBilling: () => mocks.billing,
}))
vi.mock("./signup-approval", () => ({
  approveSignup: mocks.approve,
  rejectSignup: mocks.reject,
}))
vi.mock("./enterprise-plan", () => ({ assignEnterprisePlan: mocks.assign }))
import { approveSignupAction, rejectSignupAction } from "./signups-actions"
const user = "4051f657-26ee-41de-a8e1-b37be051fd40"
const version = "149bc42a-e73b-43ab-9c36-1b6861c14665"
beforeEach(() => {
  mocks.impersonation.mockReset().mockResolvedValue(null)
  mocks.approve.mockReset().mockResolvedValue({ ok: true, outcome: "approved" })
  mocks.reject.mockReset().mockResolvedValue({ ok: true, outcome: "rejected" })
  mocks.assign.mockReset()
  mocks.allowed = true
  mocks.billing = true
})
it.each(["approve", "reject", "resend"])(
  "blocks %s before provisioning, metadata writes, provider calls or email during read-only impersonation",
  async (action) => {
    mocks.impersonation.mockResolvedValue("another-team")
    const run =
      action === "reject"
        ? rejectSignupAction(user)
        : approveSignupAction(user, action === "resend" ? "" : version)
    await expect(run).rejects.toThrow("read_only_impersonation")
    expect(mocks.approve).not.toHaveBeenCalled()
    expect(mocks.reject).not.toHaveBeenCalled()
    expect(mocks.assign).not.toHaveBeenCalled()
  },
)
it("retains staff permission checks", async () => {
  mocks.allowed = false
  await expect(rejectSignupAction(user)).rejects.toThrow(
    "signup approval access required",
  )
  expect(mocks.reject).not.toHaveBeenCalled()
})
it("still allows an authorized non-impersonating staff action", async () => {
  await expect(rejectSignupAction(user)).resolves.toEqual({
    ok: true,
    outcome: "rejected",
  })
  expect(mocks.reject).toHaveBeenCalledWith(user, "operator")
})

it("assigns the frozen winner plan passed by the durable approval coordinator", async () => {
  await approveSignupAction(user, version)
  expect(mocks.approve).toHaveBeenCalledWith(
    user,
    "operator",
    version,
    expect.any(Function),
  )
  const assignWinner = mocks.approve.mock.calls[0][3]
  const frozenVersion = "9ab14bf2-0870-4578-aa01-24383ab97140"
  const team = { id: "team", region: "usw", name: "Applicant" }
  await assignWinner(team, frozenVersion)
  expect(mocks.assign).toHaveBeenCalledWith(team, user, frozenVersion)
})
