import { describe, expect, it } from "vitest"

import { defaultInviteRole, type TeamRole } from "./roles"

describe("defaultInviteRole", () => {
  it.each<{ allowed: TeamRole[]; expected: TeamRole | undefined }>([
    {
      allowed: [
        "team_owner",
        "viewer",
        "billing_admin",
        "user_admin",
        "team_admin",
      ],
      expected: "team_admin",
    },
    { allowed: ["team_admin"], expected: "team_admin" },
    {
      allowed: ["team_owner", "user_admin", "billing_admin", "viewer"],
      expected: "viewer",
    },
    {
      allowed: ["team_owner", "user_admin", "billing_admin"],
      expected: "billing_admin",
    },
    { allowed: ["team_owner", "user_admin"], expected: "user_admin" },
    { allowed: ["team_owner"], expected: undefined },
    { allowed: [], expected: undefined },
  ])("returns $expected for $allowed", ({ allowed, expected }) => {
    expect(defaultInviteRole(allowed)).toBe(expected)
  })
})
