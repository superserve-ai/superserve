import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  loadInviteView: vi.fn(),
  acceptInviteAndSelectTeam: vi.fn(),
}))

vi.mock("@/lib/invite/accept", () => mocks)
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`)
  },
}))

import { GET } from "./route"

const token = `ssinv_use_${"A".repeat(43)}`
const user = { id: "user-1", email: "invitee@example.com" }
const preview = { teamName: "Acme" }

async function visit(raw: string): Promise<string> {
  try {
    await GET(undefined as never, { params: Promise.resolve({ token: raw }) })
  } catch (error) {
    return (error as Error).message.replace("REDIRECT:", "")
  }
  throw new Error("expected a redirect")
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe("invite auto-join route", () => {
  it("sends an invalid token to the home page without any lookup", async () => {
    expect(await visit("../../admin")).toBe("/")
    expect(mocks.loadInviteView).not.toHaveBeenCalled()
  })

  it.each(["signed_out", "confirm", "mismatch", "unavailable"])(
    "never accepts for a %s view",
    async (kind) => {
      mocks.loadInviteView.mockResolvedValue({
        view: { kind, preview },
        user,
      })

      expect(await visit(token)).toBe(`/invite/${token}/`)
      expect(mocks.acceptInviteAndSelectTeam).not.toHaveBeenCalled()
    },
  )

  it("accepts for a team-less account and lands in the console", async () => {
    mocks.loadInviteView.mockResolvedValue({
      view: { kind: "auto_accept", preview },
      user,
    })
    mocks.acceptInviteAndSelectTeam.mockResolvedValue({ ok: true })

    expect(await visit(token)).toBe("/sandboxes")
    expect(mocks.acceptInviteAndSelectTeam).toHaveBeenCalledWith(token, user)
  })

  it("returns a refusal to the page instead of retrying", async () => {
    mocks.loadInviteView.mockResolvedValue({
      view: { kind: "auto_accept", preview },
      user,
    })
    mocks.acceptInviteAndSelectTeam.mockResolvedValue({
      ok: false,
      error: "email_unverified",
    })

    expect(await visit(token)).toBe(`/invite/${token}/?failed=unavailable`)
  })
})
