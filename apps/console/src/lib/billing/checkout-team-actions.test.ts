import { beforeEach, describe, expect, it, vi } from "vitest"

const { getUser, listTeamsAction } = vi.hoisted(() => ({
  getUser: vi.fn(),
  listTeamsAction: vi.fn(),
}))
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({ auth: { getUser } }),
}))
vi.mock("@/lib/api/teams-actions", () => ({ listTeamsAction }))

import { getCheckoutTeamAction } from "./checkout-team-actions"

const locator = { account: "user", team: "use:team" }
const team = {
  id: "team",
  name: "Example team",
  region: "use",
  private: "hidden",
}

beforeEach(() => {
  getUser.mockReset().mockResolvedValue({ data: { user: { id: "user" } } })
  listTeamsAction.mockReset().mockResolvedValue({
    teams: [team],
    activeTeamId: "other-team",
    activeRegion: "use",
  })
})

describe("getCheckoutTeamAction", () => {
  it("does not read teams for a signed-out session", async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    expect(await getCheckoutTeamAction(locator)).toEqual({ kind: "signed_out" })
    expect(getUser).toHaveBeenCalledTimes(1)
    expect(listTeamsAction).not.toHaveBeenCalled()
  })

  it("does not read teams for another account", async () => {
    expect(
      await getCheckoutTeamAction({ ...locator, account: "other" }),
    ).toEqual({
      kind: "other_account",
    })
    expect(getUser).toHaveBeenCalledTimes(1)
    expect(listTeamsAction).not.toHaveBeenCalled()
  })

  it("returns only the checkout team's public fields when it can be switched to", async () => {
    expect(await getCheckoutTeamAction(locator)).toEqual({
      kind: "switch",
      team: { id: "team", name: "Example team", region: "use" },
    })
    expect(getUser).toHaveBeenCalledTimes(1)
    expect(listTeamsAction).toHaveBeenCalledTimes(1)
  })

  it.each([
    ["use", "open"],
    ["usw", "switch"],
  ])(
    "checks both the active id and region (%s)",
    async (activeRegion, kind) => {
      listTeamsAction.mockResolvedValue({
        teams: [team],
        activeTeamId: "team",
        activeRegion,
      })
      expect((await getCheckoutTeamAction(locator)).kind).toBe(kind)
      expect(listTeamsAction).toHaveBeenCalledTimes(1)
    },
  )

  it.each([{ teams: [] }, { teams: [{ ...team, region: "usw" }] }])(
    "requires membership in the exact checkout region and team ($teams)",
    async ({ teams }) => {
      listTeamsAction.mockResolvedValue({ teams })
      expect(await getCheckoutTeamAction(locator)).toEqual({
        kind: "not_member",
      })
      expect(listTeamsAction).toHaveBeenCalledTimes(1)
    },
  )

  it("lets team lookup errors reach the client retry", async () => {
    const error = new Error("Unavailable")
    listTeamsAction.mockRejectedValue(error)
    await expect(getCheckoutTeamAction(locator)).rejects.toBe(error)
    expect(listTeamsAction).toHaveBeenCalledTimes(1)
  })
})
