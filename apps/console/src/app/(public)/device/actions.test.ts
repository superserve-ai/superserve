import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  team: { teamId: "team-b", region: "use" },
  plan: "committed",
  approve: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: { id: "user-1", app_metadata: {} } },
      }),
    },
  }),
}))
vi.mock("@/lib/api/api-key-mint", () => ({
  getOrCreateTeamForUser: async () => state.team,
}))
vi.mock("@/lib/api/signup-plan-read", () => ({
  readSignupPlan: async () => ({ state: state.plan, teamKey: "use:team-b" }),
}))
vi.mock("@/lib/auth/device-login", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/device-login")>()),
  approveDeviceCode: state.approve,
}))

import { approveDeviceAction } from "./actions"

describe("approveDeviceAction", () => {
  beforeEach(() => {
    state.approve.mockReset()
    state.plan = "committed"
  })

  it("approves for the team the page showed", async () => {
    expect(await approveDeviceAction("BCDF-GHJK", "use:team-b")).toEqual({
      status: "approved",
    })
    expect(state.approve).toHaveBeenCalledOnce()
  })

  it("refuses when the active team changed after the page rendered", async () => {
    expect(await approveDeviceAction("BCDF-GHJK", "use:team-a")).toMatchObject({
      status: "error",
    })
    expect(state.approve).not.toHaveBeenCalled()
  })

  it("sends a team still choosing a plan to choose one instead of Free", async () => {
    state.plan = "selecting"
    const result = await approveDeviceAction("BCDF-GHJK", "use:team-b")
    expect(result).toMatchObject({ status: "redirect" })
    expect(result.status === "redirect" && result.to).toMatch(
      /^\/onboarding\/plan\/\?team=use%3Ateam-b$/,
    )
    expect(state.approve).not.toHaveBeenCalled()
  })
})
