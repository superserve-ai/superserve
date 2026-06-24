import { afterEach, describe, expect, it, vi } from "vitest"

const { upsertSpy, updateEqSpy } = vi.hoisted(() => ({
  upsertSpy: vi.fn(async () => ({ error: null })),
  updateEqSpy: vi.fn(async () => ({ error: null })),
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      upsert: upsertSpy,
      update: () => ({ eq: updateEqSpy }),
    }),
  }),
}))

import {
  deriveImpersonationKey,
  ensureImpersonationKeyRow,
  revokeImpersonationKeyRow,
} from "./impersonation-key"

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

describe("ensureImpersonationKeyRow refresh caching", () => {
  afterEach(() => {
    upsertSpy.mockClear()
    updateEqSpy.mockClear()
  })

  it("upserts once, then skips the DB write while the key stays unexpired", async () => {
    // Distinct (admin, team) so the module-level cache doesn't carry over from
    // other tests in this file.
    await ensureImpersonationKeyRow("cache-admin", "cache-team", 30)
    await ensureImpersonationKeyRow("cache-admin", "cache-team", 30)
    await ensureImpersonationKeyRow("cache-admin", "cache-team", 30)
    expect(upsertSpy).toHaveBeenCalledTimes(1)
  })

  it("re-upserts after a revoke invalidates the cache", async () => {
    await ensureImpersonationKeyRow("revoke-admin", "revoke-team", 30)
    expect(upsertSpy).toHaveBeenCalledTimes(1)
    await revokeImpersonationKeyRow("revoke-admin", "revoke-team")
    await ensureImpersonationKeyRow("revoke-admin", "revoke-team", 30)
    expect(upsertSpy).toHaveBeenCalledTimes(2)
  })
})
