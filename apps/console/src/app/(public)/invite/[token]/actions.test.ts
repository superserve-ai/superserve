import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  signOut: vi.fn(),
  acceptInviteAndSelectTeam: vi.fn(),
  loadInviteView: vi.fn(),
  setInviteIntent: vi.fn(),
  clearInviteIntent: vi.fn(),
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`)
  }),
}))

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: { getUser: mocks.getUser, signOut: mocks.signOut },
  }),
}))
vi.mock("@/lib/invite/accept", () => ({
  acceptInviteAndSelectTeam: mocks.acceptInviteAndSelectTeam,
  loadInviteView: mocks.loadInviteView,
}))
vi.mock("@/lib/invite/intent", () => ({
  setInviteIntent: mocks.setInviteIntent,
  clearInviteIntent: mocks.clearInviteIntent,
}))
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }))

import {
  autoJoinInviteAction,
  beginInviteAuthAction,
  joinInviteAction,
  signOutForInviteAction,
} from "./actions"

const token = `ssinv_use_${"A".repeat(43)}`
const verified = {
  id: "user-1",
  email: "invitee@example.com",
  email_confirmed_at: "2026-11-01T00:00:00Z",
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.redirect.mockImplementation((to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`)
  })
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
    expect(mocks.acceptInviteAndSelectTeam).toHaveBeenCalledWith(
      token,
      verified,
    )
    expect(mocks.clearInviteIntent).toHaveBeenCalled()
  })

  it("does not need signup intent for an explicit click", async () => {
    mocks.acceptInviteAndSelectTeam.mockResolvedValue({ ok: true })

    await joinInviteAction(token)

    expect(mocks.loadInviteView).not.toHaveBeenCalled()
  })

  it("reports an ineligible signup as its own refusal", async () => {
    mocks.acceptInviteAndSelectTeam.mockResolvedValue({
      ok: false,
      error: "not_eligible",
    })

    expect(await joinInviteAction(token)).toEqual({
      status: "error",
      code: "not_eligible",
    })
    expect(mocks.clearInviteIntent).not.toHaveBeenCalled()
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
    expect(mocks.setInviteIntent).toHaveBeenCalledWith(token)
  })

  it("does nothing for a malformed token", async () => {
    expect(await signOutForInviteAction("//evil")).toEqual({ status: "error" })
    expect(mocks.signOut).not.toHaveBeenCalled()
  })
})

describe("autoJoinInviteAction", () => {
  it("rejects a malformed token without touching auth", async () => {
    expect(await autoJoinInviteAction("nope")).toEqual({
      status: "error",
      code: "unavailable",
    })
    expect(mocks.getUser).not.toHaveBeenCalled()
  })

  it("joins when the page decision is still an auto-accept", async () => {
    mocks.loadInviteView.mockResolvedValue({ view: { kind: "auto_accept" } })
    mocks.acceptInviteAndSelectTeam.mockResolvedValue({ ok: true })

    expect(await autoJoinInviteAction(token)).toEqual({
      status: "redirect",
      to: "/sandboxes",
    })
    expect(mocks.loadInviteView).toHaveBeenCalledWith(token)
    expect(mocks.clearInviteIntent).toHaveBeenCalled()
  })

  it.each(["confirm", "mismatch", "unavailable", "already_member"])(
    "goes back to the page without joining when the decision is %s",
    async (kind) => {
      mocks.loadInviteView.mockResolvedValue({ view: { kind } })

      expect(await autoJoinInviteAction(token)).toEqual({
        status: "redirect",
        to: `/invite/${token}/`,
      })
      expect(mocks.acceptInviteAndSelectTeam).not.toHaveBeenCalled()
      expect(mocks.clearInviteIntent).not.toHaveBeenCalled()
    },
  )

  it("does nothing for a signed-out caller", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } })

    expect(await autoJoinInviteAction(token)).toEqual({
      status: "redirect",
      to: `/invite/${token}/`,
    })
    expect(mocks.loadInviteView).not.toHaveBeenCalled()
    expect(mocks.acceptInviteAndSelectTeam).not.toHaveBeenCalled()
  })
})

describe("beginInviteAuthAction", () => {
  it.each(["signup", "signin"] as const)(
    "records intent before sending the %s flow back to the invite",
    async (mode) => {
      await expect(beginInviteAuthAction(token, mode)).rejects.toThrow(
        `NEXT_REDIRECT:/auth/${mode}?next=${encodeURIComponent(`/invite/${token}`)}`,
      )
      expect(mocks.setInviteIntent).toHaveBeenCalledWith(token)
    },
  )

  it("records nothing for a malformed token", async () => {
    await expect(beginInviteAuthAction("//evil", "signup")).rejects.toThrow(
      "NEXT_REDIRECT:/",
    )
    expect(mocks.setInviteIntent).not.toHaveBeenCalled()
  })
})
