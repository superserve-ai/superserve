import { describe, expect, it } from "vitest"

import type { TeamManagementCapabilities } from "@/lib/api/team-management"

import { inviteControlState } from "./invitations-section"

const none: TeamManagementCapabilities = {
  can_view_role_assignments: false,
  can_invite_members: false,
  can_deactivate_members: false,
  can_assign_roles: false,
  can_revoke_roles: false,
}

describe("inviteControlState", () => {
  it("hides the control without the invite permission", () => {
    expect(inviteControlState(none)).toBe("hidden")
    expect(inviteControlState({ ...none, can_invite_owners: true })).toBe(
      "hidden",
    )
  })

  it("grays it out on a Free plan team", () => {
    expect(
      inviteControlState({
        ...none,
        can_invite_members: true,
        can_invite_owners: false,
        invite_blocked_reason: "free_plan",
      }),
    ).toBe("blocked_free_plan")
  })

  it("uses the new roles capability without requiring owner invitation permission", () => {
    expect(
      inviteControlState({
        ...none,
        can_invite_members: true,
        can_invite_owners: false,
        invitable_roles: ["viewer"],
      }),
    ).toBe("enabled")
    expect(
      inviteControlState({
        ...none,
        can_invite_members: true,
        can_invite_owners: true,
        invitable_roles: [],
      }),
    ).toBe("hidden")
  })

  it("enables it only when the backend allows owner invites", () => {
    const base = { ...none, can_invite_members: true }
    expect(inviteControlState({ ...base, can_invite_owners: true })).toBe(
      "enabled",
    )
    expect(inviteControlState({ ...base, can_invite_owners: false })).toBe(
      "hidden",
    )
    expect(inviteControlState(base)).toBe("hidden")
  })
})
