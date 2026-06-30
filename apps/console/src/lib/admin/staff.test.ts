import type { User } from "@supabase/supabase-js"
import { describe, expect, it } from "vitest"

import { canImpersonateUsers, canViewOtherUsersAccount, isStaff } from "./staff"

function user(
  email: string,
  provider = "google",
  providers = ["google"],
  permissions: string[] = [],
): User {
  return {
    id: "u1",
    email,
    app_metadata: { provider, providers, permissions },
  } as unknown as User
}

describe("isStaff", () => {
  it("accepts a google-verified staff-domain email", () => {
    expect(isStaff(user("alejandro@superserve.ai"))).toBe(true)
  })
  it("rejects the staff domain when provider is not google", () => {
    expect(isStaff(user("attacker@superserve.ai", "email", ["email"]))).toBe(
      false,
    )
  })
  it("rejects a google login on a different domain", () => {
    expect(isStaff(user("someone@gmail.com"))).toBe(false)
  })
  it("rejects null / no email", () => {
    expect(isStaff(null)).toBe(false)
    expect(
      isStaff({ id: "x", app_metadata: { provider: "google" } } as User),
    ).toBe(false)
  })
})

describe("users:read permission", () => {
  it("detects users:read on the auth claim", () => {
    expect(
      canViewOtherUsersAccount(
        user("a@superserve.ai", "google", ["google"], ["users:read"]),
      ),
    ).toBe(true)
  })

  it("requires both staff and users:read for impersonation", () => {
    expect(
      canImpersonateUsers(
        user("a@superserve.ai", "google", ["google"], ["users:read"]),
      ),
    ).toBe(true)
    expect(
      canImpersonateUsers(user("a@superserve.ai", "google", ["google"], [])),
    ).toBe(false)
    expect(
      canImpersonateUsers(
        user("a@gmail.com", "google", ["google"], ["users:read"]),
      ),
    ).toBe(false)
  })
})
