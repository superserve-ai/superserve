import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  signOut: vi.fn(),
  acceptInviteAndSelectTeam: vi.fn(),
}))

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: { getUser: mocks.getUser, signOut: mocks.signOut },
  }),
}))
vi.mock("@/lib/invite/accept", () => ({
  acceptInviteAndSelectTeam: mocks.acceptInviteAndSelectTeam,
}))

import { joinInviteAction, signOutForInviteAction } from "./actions"

const token = `ssinv_use_${"A".repeat(43)}`
const verified = {
  id: "user-1",
  email: "invitee@example.com",
  email_confirmed_at: "2026-11-01T00:00:00Z",
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.getUser.mockResolvedValue({ data: { user: verified } })
})

describe("joinInviteAction", () => {
  it("rejects a malformed token without touching auth", async () => {
    expect(await joinInviteAction("nope")).toEqual({
      status: "error",
      code: "unavailable",
    })
    expect(mocks.getUser).not.toHaveBeenCalled()
  })

  it("sends a signed-out caller back to the invite page", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } })

    expect(await joinInviteAction(token)).toEqual({
      status: "redirect",
      to: `/invite/${token}/`,
    })
    expect(mocks.acceptInviteAndSelectTeam).not.toHaveBeenCalled()
  })

  it("does not accept for an unverified email", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { ...verified, email_confirmed_at: null } },
    })

    expect(await joinInviteAction(token)).toEqual({
      status: "error",
      code: "unavailable",
    })
    expect(mocks.acceptInviteAndSelectTeam).not.toHaveBeenCalled()
  })

  it("joins and moves on to the console", async () => {
    mocks.acceptInviteAndSelectTeam.mockResolvedValue({ ok: true })

    expect(await joinInviteAction(token)).toEqual({
      status: "redirect",
      to: "/sandboxes",
    })
  })

  it("reports a definitive refusal and swallows thrown errors", async () => {
    mocks.acceptInviteAndSelectTeam.mockResolvedValueOnce({
      ok: false,
      error: "already_member",
    })
    expect(await joinInviteAction(token)).toEqual({
      status: "error",
      code: "already_member",
    })

    mocks.acceptInviteAndSelectTeam.mockRejectedValueOnce(new Error("boom"))
    expect(await joinInviteAction(token)).toEqual({
      status: "error",
      code: "failed",
    })
  })
})

describe("signOutForInviteAction", () => {
  it("signs out and returns to sign-in with only the invite path as next", async () => {
    expect(await signOutForInviteAction(token)).toEqual({
      status: "redirect",
      to: `/auth/signin?next=${encodeURIComponent(`/invite/${token}`)}`,
    })
    expect(mocks.signOut).toHaveBeenCalled()
  })

  it("does nothing for a malformed token", async () => {
    expect(await signOutForInviteAction("//evil")).toEqual({ status: "error" })
    expect(mocks.signOut).not.toHaveBeenCalled()
  })
})
