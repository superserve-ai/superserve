import { beforeEach, expect, it, vi } from "vitest"

const m = vi.hoisted(() => ({
  user: vi.fn(),
  impersonation: vi.fn(),
  memberships: vi.fn(),
  selection: vi.fn(),
  teams: vi.fn(),
  read: vi.fn(),
}))
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error(url), { redirect: true })
  },
  unstable_rethrow: (error: { redirect?: boolean }) => {
    if (error.redirect) throw error
  },
}))
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({ auth: { getUser: m.user } }),
}))
vi.mock("@/lib/admin/impersonation", () => ({
  getImpersonationContext: m.impersonation,
}))
vi.mock("@/lib/api/team-directory", () => ({
  listTeamMembershipsForUserDetailed: m.memberships,
}))
vi.mock("@/lib/api/team-provisioning", () => ({
  completedMemberships: async (_: string, value: unknown) => value,
}))
vi.mock("@/lib/api/active-team", () => ({
  readTeamSelection: m.selection,
  pickActiveTeam: (teams: unknown[]) => teams[0],
}))
vi.mock("@/lib/api/teams-actions", () => ({ listTeamsAction: m.teams }))
vi.mock("@/lib/api/signup-plan-read", () => ({ readSignupPlan: m.read }))
import { getSignupPlanPage } from "./signup-plan-page"

beforeEach(() => {
  vi.clearAllMocks()
  m.user.mockResolvedValue({ data: { user: { id: "owner" } } })
  m.impersonation.mockResolvedValue(null)
  m.memberships.mockResolvedValue({
    memberships: [{ teamId: "team", region: "use" }],
    degradedRegions: [],
  })
  m.teams.mockResolvedValue({
    teams: [{ id: "team", region: "use", name: "Team" }],
    activeTeamId: "team",
    activeRegion: "use",
    regions: ["use"],
  })
  m.read.mockResolvedValue({
    userId: "owner",
    teamKey: "use:team",
    state: "selecting",
    offer: null,
  })
})

it("resolves the context and directory before rendering", async () => {
  const result = await getSignupPlanPage({ team: "use:team", account: "owner" })
  expect(result?.context.state).toBe("selecting")
  expect(result?.directory.activeTeamId).toBe("team")
  expect(m.read).toHaveBeenCalledWith(
    "owner",
    { teamId: "team", region: "use" },
    "use:team",
  )
  expect(m.memberships).toHaveBeenCalledWith("owner", { maxAgeMs: 0 })
})
it("preserves checkout identity through authentication and preparation", async () => {
  m.user.mockResolvedValueOnce({ data: { user: null } })
  await expect(
    getSignupPlanPage({
      team: "use:team",
      account: "owner",
      billing: "success",
    }),
  ).rejects.toThrow("/auth/signin?next=")
  m.memberships.mockResolvedValue({ memberships: [], degradedRegions: [] })
  await expect(
    getSignupPlanPage({
      team: "use:team",
      account: "owner",
      billing: "success",
    }),
  ).rejects.toThrow(
    "/api/onboarding/prepare/?team=use%3Ateam&account=owner&billing=success",
  )
  expect(m.read).not.toHaveBeenCalled()
})
it("shows recovery after provisioning fails instead of redirecting in a loop", async () => {
  m.memberships.mockResolvedValue({ memberships: [], degradedRegions: [] })
  expect(await getSignupPlanPage({ setup_error: "1" })).toBeNull()
})
it("rejects changed accounts and impersonated sessions before reading plans", async () => {
  expect(await getSignupPlanPage({ account: "other" })).toBeNull()
  m.impersonation.mockResolvedValue({ teamId: "other" })
  expect(await getSignupPlanPage()).toBeNull()
  expect(m.memberships).not.toHaveBeenCalled()
  expect(m.read).not.toHaveBeenCalled()
})
it("fails closed on degraded membership, directory races, and plan read failures", async () => {
  m.memberships.mockResolvedValueOnce({
    memberships: [],
    degradedRegions: ["use"],
  })
  expect(await getSignupPlanPage()).toBeNull()
  m.teams.mockResolvedValueOnce({ teams: [], regions: ["use"] })
  expect(await getSignupPlanPage()).toBeNull()
  m.read.mockRejectedValue(new Error("Unavailable"))
  expect(await getSignupPlanPage()).toBeNull()
})

it("keeps an established team available when an unrelated region is degraded", async () => {
  m.memberships.mockResolvedValue({
    memberships: [{ teamId: "team", region: "use" }],
    degradedRegions: ["usw"],
  })
  expect((await getSignupPlanPage())?.context.teamKey).toBe("use:team")
})
