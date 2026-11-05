import { AuthSessionMissingError } from "@supabase/supabase-js"
import { beforeEach, expect, it, vi } from "vitest"

const m = vi.hoisted(() => ({
  user: vi.fn(),
  impersonation: vi.fn(),
  memberships: vi.fn(),
  selection: vi.fn(),
  teams: vi.fn(),
  read: vi.fn(),
  prepare: vi.fn(),
  fresh: false,
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
vi.mock("@/lib/supabase/fresh-fetch", () => ({
  readFresh: async <T>(read: () => Promise<T>) => {
    m.fresh = true
    try {
      return await read()
    } finally {
      m.fresh = false
    }
  },
}))
vi.mock("@/lib/api/signup-plan-actions", () => ({
  getSignupPlanAction: m.prepare,
}))
import { GET as prepareAccount } from "@/app/api/onboarding/prepare/route"
import { SignupSetupBlockedError } from "@/lib/api/signup-setup-error"

import { getSignupPlanPage, getSignupPlanPageState } from "./signup-plan-page"

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
  m.prepare.mockResolvedValue({
    userId: "owner",
    teamKey: "use:team",
    state: "committed",
    offer: "free",
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

it("stops after successful preparation if fresh membership still finds no team", async () => {
  // The preparation action can still see its cached team after the last
  // membership was revoked; the page intentionally performs a fresh read.
  m.memberships.mockResolvedValue({ memberships: [], degradedRegions: [] })
  const initialRedirect = await getSignupPlanPage().catch((error) => {
    expect(error.redirect).toBe(true)
    return new URL(error.message, "https://console.test")
  })
  expect(initialRedirect).toBeInstanceOf(URL)
  const preparedRedirect = await prepareAccount(
    new Request(initialRedirect as URL),
  ).catch((error) => {
    expect(error.redirect).toBe(true)
    return new URL(error.message, "https://console.test")
  })
  if (!preparedRedirect) throw new Error("Expected preparation to redirect")
  expect(
    await getSignupPlanPage(Object.fromEntries(preparedRedirect.searchParams)),
  ).toBeNull()
  expect(m.prepare).toHaveBeenCalledTimes(1)
  expect(m.read).not.toHaveBeenCalled()
})

it("still renders a freshly resolved team after a preparation attempt", async () => {
  expect(
    (await getSignupPlanPage({ setup_attempted: "1" }))?.context.teamKey,
  ).toBe("use:team")
})
it("rejects changed accounts and impersonated sessions before reading plans", async () => {
  expect(await getSignupPlanPage({ account: "other" })).toBeNull()
  m.impersonation.mockResolvedValue({ teamId: "other" })
  expect(await getSignupPlanPage()).toBeNull()
  expect(m.memberships).not.toHaveBeenCalled()
  expect(m.read).not.toHaveBeenCalled()
  // A retry can't change either answer, so neither is read twice.
  expect(m.user).toHaveBeenCalledTimes(2)
})
it("fails closed on degraded membership, directory races, and plan read failures", async () => {
  m.memberships.mockResolvedValue({
    memberships: [],
    degradedRegions: ["use"],
  })
  expect(await getSignupPlanPage()).toBeNull()
  m.memberships.mockResolvedValue({
    memberships: [{ teamId: "team", region: "use" }],
    degradedRegions: [],
  })
  m.teams.mockResolvedValue({ teams: [], regions: ["use"] })
  expect(await getSignupPlanPage()).toBeNull()
  m.teams.mockResolvedValue({
    teams: [{ id: "team", region: "use", name: "Team" }],
    regions: ["use"],
  })
  m.read.mockRejectedValue(new Error("Unavailable"))
  expect(await getSignupPlanPage()).toBeNull()
})
it("retries a failed plan read once and renders when the retry succeeds", async () => {
  const fresh: boolean[] = []
  m.read.mockImplementation(async () => {
    fresh.push(m.fresh)
    if (fresh.length === 1) throw new Error("Unavailable")
    return { userId: "owner", teamKey: "use:team", state: "selecting" }
  })
  expect((await getSignupPlanPage())?.context.teamKey).toBe("use:team")
  // Only the retry skips the render's request memoization.
  expect(fresh).toEqual([false, true])
})
it("retries a degraded membership lookup once before rendering", async () => {
  m.memberships.mockResolvedValueOnce({
    memberships: [],
    degradedRegions: ["use"],
  })
  expect((await getSignupPlanPage())?.context.teamKey).toBe("use:team")
  expect(m.memberships).toHaveBeenCalledTimes(2)
})
it("still blocks after one retry when the plan read keeps failing", async () => {
  m.read.mockRejectedValue(
    new Error("Unable to check your plan. Please retry."),
  )
  expect(await getSignupPlanPage()).toBeNull()
  expect(m.read).toHaveBeenCalledTimes(2)
})
it("doesn't retry a team change or a redirect", async () => {
  m.read.mockRejectedValue(new SignupSetupBlockedError("team_changed"))
  expect(await getSignupPlanPage({ team: "use:other" })).toBeNull()
  expect(m.read).toHaveBeenCalledTimes(1)
  m.user.mockResolvedValueOnce({ data: { user: null } })
  await expect(getSignupPlanPage()).rejects.toThrow("/auth/signin?next=")
  expect(m.user).toHaveBeenCalledTimes(2)
})

it("keeps an established team available when an unrelated region is degraded", async () => {
  m.memberships.mockResolvedValue({
    memberships: [{ teamId: "team", region: "use" }],
    degradedRegions: ["usw"],
  })
  expect((await getSignupPlanPage())?.context.teamKey).toBe("use:team")
})

it("sends an expired session to sign-in instead of the setup error", async () => {
  m.user.mockResolvedValue({
    data: { user: null },
    error: new AuthSessionMissingError(),
  })
  await expect(getSignupPlanPage()).rejects.toThrow(
    "/auth/signin?next=%2Fonboarding%2Fplan%2F%3F",
  )
})

it("tells a plan that stayed unreadable apart from a blocked answer", async () => {
  m.read.mockRejectedValue(new Error("Unable to check your plan."))
  expect(await getSignupPlanPageState()).toEqual({ status: "unavailable" })
  expect(m.read).toHaveBeenCalledTimes(2)
  m.read.mockRejectedValue(new SignupSetupBlockedError("team_changed"))
  expect(await getSignupPlanPageState()).toEqual({ status: "blocked" })
  expect(await getSignupPlanPageState({ account: "other" })).toEqual({
    status: "blocked",
  })
  m.memberships.mockResolvedValue({ memberships: [], degradedRegions: [] })
  expect(await getSignupPlanPageState({ setup_error: "1" })).toEqual({
    status: "blocked",
  })
})
it("reports a plan read that a retry recovered as ready", async () => {
  m.read.mockRejectedValueOnce(new Error("Unavailable"))
  const state = await getSignupPlanPageState()
  expect(state.status === "ready" && state.page.context.teamKey).toBe(
    "use:team",
  )
})
