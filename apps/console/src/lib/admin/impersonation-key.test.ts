import { describe, expect, it } from "vitest"

import { deriveImpersonationKey } from "./impersonation-key"

describe("deriveImpersonationKey", () => {
  it("is deterministic per (admin, team) and ss_live-prefixed", () => {
    const k1 = deriveImpersonationKey("admin-1", "team-1")
    const k2 = deriveImpersonationKey("admin-1", "team-1")
    expect(k1).toBe(k2)
    expect(k1.startsWith("ss_live_")).toBe(true)
  })
  it("differs per admin and per team", () => {
    expect(deriveImpersonationKey("admin-1", "team-1")).not.toBe(
      deriveImpersonationKey("admin-2", "team-1"),
    )
    expect(deriveImpersonationKey("admin-1", "team-1")).not.toBe(
      deriveImpersonationKey("admin-1", "team-2"),
    )
  })
})
