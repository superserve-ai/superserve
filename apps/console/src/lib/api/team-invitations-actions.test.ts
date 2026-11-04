import { createHash } from "node:crypto"

import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  getKeyAndTeam: vi.fn(),
  listTeams: vi.fn(),
  listMemberships: vi.fn(),
  invalidate: vi.fn(),
  completed: vi.fn(),
  writeSelection: vi.fn(),
  sendEmail: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({ auth: { getUser: mocks.getUser } }),
}))
vi.mock("@/lib/api/proxy-auth", () => ({
  getAuthApiKeyAndTeamForUser: mocks.getKeyAndTeam,
}))
vi.mock("@/lib/api/team-directory", () => ({
  listTeamsForUser: mocks.listTeams,
  listTeamMembershipsForUserDetailed: mocks.listMemberships,
  invalidateMembershipDirectory: mocks.invalidate,
}))
vi.mock("@/lib/api/team-provisioning", () => ({
  completedMemberships: mocks.completed,
}))
vi.mock("@/lib/api/active-team", async () => ({
  pickActiveTeam: (memberships: { teamId: string; region: string }[]) =>
    memberships[0] ?? null,
  writeTeamSelection: mocks.writeSelection,
}))
vi.mock("@/lib/cells", () => ({
  DEFAULT_REGION: "use",
  cellFor: (region: string) => ({
    apiBaseUrl: `https://api.${region}.test`,
    createAdminClient: () => ({ rpc: mocks.rpc }),
  }),
}))
vi.mock("@/lib/email/send", () => ({ sendEmail: mocks.sendEmail }))

const fetchSpy = vi.fn()
vi.stubGlobal("fetch", fetchSpy)

import { SignupRestrictedError } from "@/lib/auth/signup-restrictions"

import {
  createInvitationAction,
  leaveTeamAction,
  resendInvitationAction,
  revokeInvitationAction,
} from "./team-invitations-actions"

const here = { teamId: "team-1", region: "use" }
const token = `ssinv_use_${"T".repeat(43)}`
const tokenPrefix = createHash("sha256")
  .update(token)
  .digest("hex")
  .slice(0, 16)
const invitation = {
  id: "inv-1",
  email: "new@example.com",
  status: "pending",
  invited_by: "user-1",
  created_at: "2026-11-04T00:00:00Z",
  expires_at: "2026-11-11T00:00:00Z",
  last_sent_at: "2026-11-04T00:00:00Z",
  delivery_status: "pending",
  token_hash: "must-not-leak",
}

// Behaves like acquire/release_team_leave_lease: one live holder per user, an
// expired lease is taken over, release only deletes the caller's own lease.
function installLeaseStore(): Map<string, { holder: string; expires: number }> {
  const leases = new Map<string, { holder: string; expires: number }>()
  mocks.rpc.mockImplementation(
    async (
      fn: string,
      args: { p_user_id: string; p_holder: string; p_ttl_seconds?: number },
    ) => {
      const live = leases.get(args.p_user_id)
      if (fn === "acquire_team_leave_lease") {
        if (
          live &&
          live.expires > Date.now() &&
          live.holder !== args.p_holder
        ) {
          return { data: false, error: null }
        }
        leases.set(args.p_user_id, {
          holder: args.p_holder,
          expires: Date.now() + (args.p_ttl_seconds ?? 0) * 1000,
        })
        return { data: true, error: null }
      }
      if (live?.holder === args.p_holder) leases.delete(args.p_user_id)
      return { data: null, error: null }
    },
  )
  return leases
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function calls(): { url: string; init: RequestInit }[] {
  return fetchSpy.mock.calls.map(([url, init]) => ({ url, init }))
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.getUser.mockResolvedValue({
    data: {
      user: {
        id: "user-1",
        email: "owner@example.com",
        user_metadata: { full_name: "Olivia Owner" },
      },
    },
  })
  mocks.getKeyAndTeam.mockResolvedValue({
    apiKey: "ss_live_key",
    team: { teamId: "team-1", region: "use" },
  })
  mocks.listTeams.mockResolvedValue([
    { id: "team-1", name: "Acme", region: "use" },
  ])
  mocks.sendEmail.mockResolvedValue({ success: true })
  installLeaseStore()
  fetchSpy.mockImplementation(async (url: string) =>
    url.endsWith("/delivery")
      ? new Response(null, { status: 204 })
      : json({ invitation, token }, 201),
  )
})

describe("createInvitationAction", () => {
  it("never returns the token or anything beyond the invitation summary", async () => {
    const result = await createInvitationAction(here, "New@Example.com")

    expect(result.ok).toBe(true)
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain(token)
    expect(serialized).not.toContain("token")
    expect(serialized).not.toContain("must-not-leak")
    expect(result).toEqual({
      ok: true,
      delivery: "sent",
      invitation: {
        id: "inv-1",
        email: "new@example.com",
        status: "pending",
        invited_by: "user-1",
        created_at: "2026-11-04T00:00:00Z",
        expires_at: "2026-11-11T00:00:00Z",
        last_sent_at: "2026-11-04T00:00:00Z",
        delivery_status: "sent",
      },
    })
  })

  it("calls the team's cell with the caller's team API key", async () => {
    await createInvitationAction(here, "  new@example.com ")

    const [create] = calls()
    expect(create.url).toBe("https://api.use.test/teams/team-1/invitations")
    expect(new Headers(create.init.headers).get("x-api-key")).toBe(
      "ss_live_key",
    )
    expect(JSON.parse(create.init.body as string)).toEqual({
      email: "new@example.com",
    })
  })

  it("puts the token only in the emailed link and reports delivery", async () => {
    await createInvitationAction(here, "new@example.com")

    expect(mocks.sendEmail).toHaveBeenCalledTimes(1)
    const email = mocks.sendEmail.mock.calls[0][0]
    expect(email.to).toBe("new@example.com")
    expect(email.subject).toContain("Acme")
    expect(JSON.stringify(email.react)).toContain(`/invite/${token}/`)

    const delivery = calls()[1]
    expect(delivery.url).toBe(
      "https://api.use.test/teams/team-1/invitations/inv-1/delivery",
    )
    expect(JSON.parse(delivery.init.body as string)).toEqual({
      status: "sent",
      token_hash_prefix: tokenPrefix,
    })
    expect(delivery.init.body as string).not.toContain(token)
  })

  it("reports a failed email as failed without exposing the token", async () => {
    mocks.sendEmail.mockResolvedValue({ success: false })

    const result = await createInvitationAction(here, "new@example.com")

    expect(result).toMatchObject({
      ok: true,
      delivery: "failed",
      invitation: { delivery_status: "failed" },
    })
    expect(JSON.stringify(result)).not.toContain(token)
    expect(JSON.parse(calls()[1].init.body as string)).toEqual({
      status: "failed",
      token_hash_prefix: tokenPrefix,
    })
  })

  it("does not email a token for a different cell", async () => {
    fetchSpy.mockImplementation(async (url: string) =>
      url.endsWith("/delivery")
        ? new Response(null, { status: 204 })
        : json({ invitation, token: `ssinv_usw_${"T".repeat(43)}` }, 201),
    )

    const result = await createInvitationAction(here, "new@example.com")

    expect(mocks.sendEmail).not.toHaveBeenCalled()
    expect(result).toMatchObject({ ok: true, delivery: "failed" })
  })

  it("treats a malformed token as undeliverable", async () => {
    fetchSpy.mockImplementation(async (url: string) =>
      url.endsWith("/delivery")
        ? new Response(null, { status: 204 })
        : json({ invitation, token: "javascript:alert(1)" }, 201),
    )

    const result = await createInvitationAction(here, "new@example.com")

    expect(mocks.sendEmail).not.toHaveBeenCalled()
    expect(result).toMatchObject({ ok: true, delivery: "failed" })
  })

  it("still succeeds when the delivery report cannot be recorded", async () => {
    fetchSpy.mockImplementation(async (url: string) => {
      if (url.endsWith("/delivery")) throw new Error("network")
      return json({ invitation, token }, 201)
    })

    expect(await createInvitationAction(here, "new@example.com")).toMatchObject(
      {
        ok: true,
        delivery: "sent",
      },
    )
  })

  it.each([
    ["free_plan", 409],
    ["already_member", 409],
    ["invitation_pending", 409],
    ["pending_limit", 409],
    ["rate_limited", 429],
    ["bad_request", 400],
  ])("maps the backend's %s refusal", async (code, status) => {
    fetchSpy.mockResolvedValue(json({ error: { code, message: "x" } }, status))

    const result = await createInvitationAction(here, "new@example.com")

    expect(result).toMatchObject({ ok: false, code })
    expect(mocks.sendEmail).not.toHaveBeenCalled()
  })

  it("points an expired pending invitation to Resend or Revoke", async () => {
    fetchSpy.mockResolvedValue(
      json({ error: { code: "invitation_pending", message: "x" } }, 409),
    )

    const result = await createInvitationAction(here, "new@example.com")

    expect(result).toMatchObject({ ok: false, code: "invitation_pending" })
    expect((result as { message: string }).message).toMatch(
      /expired.*resend or revoke/i,
    )
  })

  it("explains the Free plan reason in the shared wording", async () => {
    fetchSpy.mockResolvedValue(
      json({ error: { code: "free_plan", message: "x" } }, 409),
    )

    expect(await createInvitationAction(here, "new@example.com")).toMatchObject(
      {
        message: "Upgrade to invite owners",
      },
    )
  })

  it("rejects an obviously invalid email before calling the backend", async () => {
    expect(await createInvitationAction(here, "not-an-email")).toMatchObject({
      ok: false,
      code: "bad_request",
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("requires a signed-in user", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } })

    expect(await createInvitationAction(here, "new@example.com")).toMatchObject(
      {
        ok: false,
        code: "unauthorized",
      },
    )
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("keeps signup restrictions in force", async () => {
    mocks.getKeyAndTeam.mockRejectedValue(new SignupRestrictedError())

    expect(await createInvitationAction(here, "new@example.com")).toMatchObject(
      {
        ok: false,
        code: "signup_blocked",
      },
    )
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe("resendInvitationAction", () => {
  it("returns no token and sends the email with the new link", async () => {
    const result = await resendInvitationAction(here, "inv-1")

    expect(calls()[0].url).toBe(
      "https://api.use.test/teams/team-1/invitations/inv-1/resend",
    )
    expect(JSON.stringify(result)).not.toContain(token)
    expect(result).toMatchObject({ ok: true, delivery: "sent" })
    expect(JSON.stringify(mocks.sendEmail.mock.calls[0][0].react)).toContain(
      token,
    )
  })

  it("maps a closed invitation", async () => {
    fetchSpy.mockResolvedValue(
      json({ error: { code: "invitation_closed", message: "x" } }, 409),
    )

    expect(await resendInvitationAction(here, "inv-1")).toMatchObject({
      ok: false,
      code: "invitation_closed",
    })
  })

  it("does not let an id escape the invitation route", async () => {
    expect(await resendInvitationAction(here, "../../members")).toMatchObject({
      ok: false,
      code: "bad_request",
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe("revokeInvitationAction", () => {
  it("only calls the backend", async () => {
    fetchSpy.mockResolvedValue(json({}, 200))

    expect(await revokeInvitationAction(here, "inv-1")).toEqual({ ok: true })
    expect(calls()).toHaveLength(1)
    expect(calls()[0].url).toBe(
      "https://api.use.test/teams/team-1/invitations/inv-1/revoke",
    )
    expect(mocks.sendEmail).not.toHaveBeenCalled()
  })

  it("maps a permission failure", async () => {
    fetchSpy.mockResolvedValue(json({}, 403))

    expect(await revokeInvitationAction(here, "inv-1")).toMatchObject({
      ok: false,
      code: "forbidden",
    })
  })
})

describe("leaveTeamAction", () => {
  const other = { teamId: "team-2", region: "usw" }

  function memberships(
    all: { teamId: string; region: string }[],
    degraded: string[] = [],
  ) {
    mocks.listMemberships.mockResolvedValue({
      memberships: all,
      degradedRegions: degraded,
    })
    mocks.completed.mockResolvedValue({
      memberships: all,
      degradedRegions: [],
    })
  }

  it("reads the directory strictly while holding the lease", async () => {
    memberships([here, other])
    fetchSpy.mockResolvedValue(new Response(null, { status: 204 }))

    await leaveTeamAction(here)

    expect(mocks.listMemberships).toHaveBeenCalledWith("user-1", {
      strict: true,
    })
    expect(mocks.rpc.mock.calls.map(([fn]) => fn)).toEqual([
      "acquire_team_leave_lease",
      "release_team_leave_lease",
    ])
    const [, acquire] = mocks.rpc.mock.calls[0]
    expect(acquire).toMatchObject({ p_user_id: "user-1", p_ttl_seconds: 60 })
    expect(mocks.rpc.mock.calls[1][1].p_holder).toBe(acquire.p_holder)
  })

  it("releases the lease when the backend refuses the leave", async () => {
    const leases = installLeaseStore()
    memberships([here, other])
    fetchSpy.mockResolvedValue(
      json({ error: { code: "last_owner", message: "x" } }, 409),
    )

    await leaveTeamAction(here)

    expect(leases.size).toBe(0)
  })

  it("still succeeds when the lease release fails", async () => {
    memberships([here, other])
    fetchSpy.mockResolvedValue(new Response(null, { status: 204 }))
    const real = mocks.rpc.getMockImplementation()!
    mocks.rpc.mockImplementation(async (fn: string, args: never) =>
      fn === "release_team_leave_lease"
        ? { data: null, error: { message: "db down" } }
        : real(fn, args),
    )
    const log = vi.spyOn(console, "error").mockImplementation(() => {})

    expect(await leaveTeamAction(here)).toEqual({ ok: true })
    expect(log).toHaveBeenCalled()
    log.mockRestore()
  })

  it.each([
    ["is held by another leave", { data: false, error: null }],
    ["errors", { data: null, error: { message: "db down" } }],
  ])("fails closed when the lease %s", async (_n, outcome) => {
    memberships([here, other])
    mocks.rpc.mockResolvedValue(outcome)

    expect(await leaveTeamAction(here)).toMatchObject({
      ok: false,
      code: "leave_in_progress",
      message: "Another leave is in progress. Try again in a moment.",
    })
    expect(mocks.listMemberships).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(mocks.invalidate).not.toHaveBeenCalled()
  })

  it("fails closed when the lease call throws", async () => {
    memberships([here, other])
    mocks.rpc.mockRejectedValue(new Error("network"))

    expect(await leaveTeamAction(here)).toMatchObject({
      ok: false,
      code: "leave_in_progress",
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("never lets overlapping leaves of two teams both succeed", async () => {
    const teamA = { teamId: "team-a", region: "use" }
    const teamB = { teamId: "team-b", region: "usw" }
    // The backend's leave removes the membership; both requests read the
    // directory through the same shared state, as they would in production.
    const state = { teams: [teamA, teamB] }
    const readDirectory = () => ({
      memberships: [...state.teams],
      degradedRegions: [] as string[],
    })
    mocks.listMemberships.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      return readDirectory()
    })
    mocks.completed.mockImplementation(async (_u: string, d: unknown) => d)
    fetchSpy.mockImplementation(async (url: string) => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      const left = url.includes("/teams/team-a/") ? teamA : teamB
      state.teams = state.teams.filter((t) => t.teamId !== left.teamId)
      return new Response(null, { status: 204 })
    })
    const asTeam = (team: typeof teamA) =>
      mocks.getKeyAndTeam.mockResolvedValueOnce({
        apiKey: "ss_live_key",
        team,
      })
    asTeam(teamA)
    asTeam(teamB)

    const results = await Promise.all([
      leaveTeamAction(teamA),
      leaveTeamAction(teamB),
    ])

    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(results.find((r) => !r.ok)).toMatchObject({
      code: "leave_in_progress",
    })
    expect(state.teams).toHaveLength(1)
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    // Once the first leave finished, the lease is free and the remaining
    // team is now the only one.
    const remaining = state.teams[0]
    asTeam(remaining)
    expect(await leaveTeamAction(remaining)).toMatchObject({
      code: "only_team",
    })
    expect(state.teams).toHaveLength(1)
  })

  it("blocks leaving the only team without calling the backend", async () => {
    memberships([here])

    expect(await leaveTeamAction(here)).toMatchObject({
      ok: false,
      code: "only_team",
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("fails closed when another region cannot be read", async () => {
    memberships([here], ["usw"])

    expect(await leaveTeamAction(here)).toMatchObject({
      ok: false,
      code: "only_team",
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("fails closed when the directory lookup throws", async () => {
    mocks.listMemberships.mockRejectedValue(new Error("down"))

    expect(await leaveTeamAction(here)).toMatchObject({
      ok: false,
      code: "only_team",
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("leaves, then switches to another team", async () => {
    memberships([here, other])
    fetchSpy.mockResolvedValue(new Response(null, { status: 204 }))

    const result = await leaveTeamAction(here)

    expect(result).toEqual({ ok: true })
    expect(calls()[0].url).toBe("https://api.use.test/teams/team-1/leave")
    expect(mocks.invalidate).toHaveBeenCalledWith("user-1")
    expect(mocks.writeSelection).toHaveBeenCalledWith({
      region: "usw",
      teamId: "team-2",
    })
  })

  it("keeps the selection when the membership is not active", async () => {
    memberships([here, other])
    fetchSpy.mockResolvedValue(
      json({ error: { code: "conflict", message: "x" } }, 409),
    )

    expect(await leaveTeamAction(here)).toMatchObject({
      ok: false,
      code: "conflict",
    })
    expect(mocks.writeSelection).not.toHaveBeenCalled()
  })

  it("keeps the selection when the last owner cannot leave", async () => {
    memberships([here, other])
    fetchSpy.mockResolvedValue(
      json({ error: { code: "last_owner", message: "x" } }, 409),
    )

    expect(await leaveTeamAction(here)).toMatchObject({
      ok: false,
      code: "last_owner",
    })
    expect(mocks.writeSelection).not.toHaveBeenCalled()
  })
})

describe("displayed team scope", () => {
  // The page showed team-1/use, but another tab moved the cookie to team-9.
  const stale = { teamId: "team-1", region: "use" }
  const moved = { teamId: "team-9", region: "use" }

  beforeEach(() => {
    mocks.getKeyAndTeam.mockResolvedValue({
      apiKey: "ss_live_key",
      team: moved,
    })
  })

  it.each([
    ["create", () => createInvitationAction(stale, "new@example.com")],
    ["resend", () => resendInvitationAction(stale, "inv-1")],
    ["revoke", () => revokeInvitationAction(stale, "inv-1")],
    ["leave", () => leaveTeamAction(stale)],
  ])("refuses to %s on a team the page was not showing", async (_n, run) => {
    expect(await run()).toMatchObject({ ok: false, code: "team_changed" })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(mocks.sendEmail).not.toHaveBeenCalled()
    expect(mocks.writeSelection).not.toHaveBeenCalled()
  })

  it("refuses a different region for the same team id", async () => {
    mocks.getKeyAndTeam.mockResolvedValue({
      apiKey: "ss_live_key",
      team: { teamId: "team-1", region: "usw" },
    })
    expect(
      await createInvitationAction(stale, "new@example.com"),
    ).toMatchObject({ ok: false, code: "team_changed" })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("refuses a missing or malformed scope", async () => {
    for (const bad of [undefined, null, {}, { teamId: 1, region: "use" }]) {
      expect(
        await createInvitationAction(bad as never, "new@example.com"),
      ).toMatchObject({ ok: false, code: "team_changed" })
    }
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
