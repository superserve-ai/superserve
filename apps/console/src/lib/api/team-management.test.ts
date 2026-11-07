import { describe, expect, it, vi } from "vitest"

import { getTeamManagement } from "./team-management"

const fetchSpy = vi.fn()
vi.stubGlobal("fetch", fetchSpy)

describe("getTeamManagement", () => {
  it.each([
    ["use:team-1", "use"],
    ["usw:team-1", "usw"],
    ["use:team-2", null],
    ["team-1", null],
    [":team-1", null],
    ["use:team-1:extra", null],
    [null, null],
  ])("resolves the region from scope header %s", async (scope, region) => {
    const body = {
      team_id: "team-1",
      members: [],
      assignments: [],
      capabilities: {
        can_view_role_assignments: false,
        can_invite_members: false,
        can_deactivate_members: false,
        can_assign_roles: false,
        can_revoke_roles: false,
      },
    }
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify(body), {
        headers: scope ? { "X-Superserve-Team-Scope": scope } : {},
      }),
    )

    expect(await getTeamManagement()).toEqual({ ...body, region })
  })
})
