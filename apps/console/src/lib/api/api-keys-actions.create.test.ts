import crypto from "node:crypto"

import { beforeEach, describe, expect, it, vi } from "vitest"

let activeTeam: { teamId: string; region: string } | null = {
  teamId: "team-1",
  region: "use",
}
vi.mock("@/lib/api/active-team", () => ({
  readTeamSelection: async () => null,
  pickActiveTeam: (memberships: Array<NonNullable<typeof activeTeam>>) =>
    memberships[0] ?? null,
}))
vi.mock("@/lib/api/team-directory", () => ({
  listTeamMembershipsForUserDetailed: async () => ({
    memberships: activeTeam ? [activeTeam] : [],
    degradedRegions: [],
  }),
  invalidateMembershipDirectory: vi.fn(),
}))
vi.mock("@/lib/api/team-provisioning", () => ({
  completedMemberships: vi.fn(
    async (
      _userId: string,
      directory: import("@/lib/api/team-directory").MembershipDirectory,
    ) => directory,
  ),
  provisionTeam: vi.fn(),
}))

vi.mock("@/lib/admin/impersonation", () => ({
  getImpersonationTeamId: async () => null,
}))
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: { id: "a1", email: "amit@superserve.ai" } },
      }),
    },
  }),
}))

// No cookie set: active-team resolution falls back to the first membership.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}))

// Per-test knobs read lazily by the admin-client mock.
let homeRegionResult: { data: unknown; error: unknown } = {
  data: { home_region: "usw" },
  error: null,
}
let insertedApiKeyRow: Record<string, unknown> | null = null

// Minimal chainable stub: every builder method returns the chain; single()
// resolves to the configured result.
function chain(result: { data: unknown; error: unknown }) {
  const c: Record<string, unknown> = {}
  for (const m of ["select", "eq", "is", "neq", "order", "limit", "update"]) {
    c[m] = () => c
  }
  c.single = async () => result
  return c
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      switch (table) {
        case "profile":
          return chain({ data: { id: "a1" }, error: null })
        case "team_memberships":
          return chain({ data: [], error: null })
        case "team_member":
          // The membership fan-out awaits the filter directly (no single()).
          return {
            select: () => ({
              eq: async () => ({ data: [{ team_id: "team-1" }], error: null }),
            }),
          }
        case "team":
          return chain(homeRegionResult)
        case "api_key": {
          const c = chain({
            data: { id: "k1", name: "test", created_at: "2026-07-01" },
            error: null,
          }) as Record<string, unknown> & {
            insert?: (row: Record<string, unknown>) => unknown
          }
          c.insert = (row: Record<string, unknown>) => {
            insertedApiKeyRow = row
            return c
          }
          return c
        }
        default:
          throw new Error(`unexpected table ${table}`)
      }
    },
  }),
}))

import {
  completedMemberships,
  provisionTeam,
} from "@/lib/api/team-provisioning"
import {
  SignupRestrictedError,
  SIGNUP_RESTRICTED_MESSAGE,
} from "@/lib/auth/signup-restrictions"

import {
  createApiKeyAction,
  listApiKeysAction,
  revokeApiKeyAction,
} from "./api-keys-actions"

async function createAllowedKey(name: string) {
  const result = await createApiKeyAction(name)
  if ("code" in result) throw new Error(result.message)
  return result
}

describe("createApiKeyAction region-prefixed keys", () => {
  beforeEach(() => {
    insertedApiKeyRow = null
    activeTeam = { teamId: "team-1", region: "use" }
    vi.mocked(completedMemberships).mockImplementation(
      async (_userId, directory) => directory,
    )
    vi.mocked(provisionTeam).mockReset()
  })

  it("does not create a key when first-team provisioning is blocked", async () => {
    activeTeam = null
    vi.mocked(provisionTeam).mockRejectedValueOnce(new SignupRestrictedError())

    await expect(createApiKeyAction("blocked")).resolves.toEqual({
      code: "signup_blocked",
      message: SIGNUP_RESTRICTED_MESSAGE,
    })
    expect(provisionTeam).toHaveBeenCalledOnce()
    expect(insertedApiKeyRow).toBeNull()

    activeTeam = { teamId: "team-1", region: "use" }
    const key = await createAllowedKey("established")
    expect(key.key).toMatch(/^ss_live_/)
    expect(provisionTeam).toHaveBeenCalledOnce()
    expect(insertedApiKeyRow).toMatchObject({
      team_id: "team-1",
      name: "established",
      created_by: "a1",
    })
  })

  it("returns the same denial for lazy list and revoke paths", async () => {
    activeTeam = null
    vi.mocked(provisionTeam).mockRejectedValue(new SignupRestrictedError())

    const denial = {
      code: "signup_blocked",
      message: SIGNUP_RESTRICTED_MESSAGE,
    }
    await expect(listApiKeysAction()).resolves.toEqual(denial)
    await expect(revokeApiKeyAction("key-1")).resolves.toEqual(denial)
    expect(insertedApiKeyRow).toBeNull()
  })

  it("does not mint a key from an unfinished owner membership after failed cleanup", async () => {
    activeTeam = { teamId: "unfinished-team", region: "use" }
    vi.mocked(completedMemberships).mockImplementation(
      async (_userId, directory) => ({ ...directory, memberships: [] }),
    )
    vi.mocked(provisionTeam).mockRejectedValueOnce(new SignupRestrictedError())

    await expect(createApiKeyAction("retry")).resolves.toEqual({
      code: "signup_blocked",
      message: SIGNUP_RESTRICTED_MESSAGE,
    })
    expect(completedMemberships).toHaveBeenCalledWith(
      "a1",
      expect.objectContaining({ memberships: [activeTeam] }),
    )
    expect(provisionTeam).toHaveBeenCalledWith(
      "use",
      "a1",
      "amit@superserve.ai",
      "amit@superserve.ai",
    )
    expect(insertedApiKeyRow).toBeNull()
  })

  it("mints a key carrying the team's home region", async () => {
    homeRegionResult = { data: { home_region: "usw" }, error: null }
    const res = await createAllowedKey("test")

    expect(res.key).toMatch(/^ss_live_usw_[A-Za-z0-9_-]{32}$/)
    // Exactly 8 random chars after the region segment.
    const randomPart = res.key.slice("ss_live_usw_".length)
    expect(res.prefix).toBe(`ss_live_usw_${randomPart.slice(0, 8)}...`)
    // Stored hash covers the full key string, region segment included.
    const wantHash = crypto.createHash("sha256").update(res.key).digest("hex")
    expect(insertedApiKeyRow?.key_hash).toBe(wantHash)
  })

  it("falls back to the default region when home_region is missing", async () => {
    // Simulates the column not existing yet (migration not applied).
    homeRegionResult = {
      data: null,
      error: { message: "column team.home_region does not exist" },
    }
    const res = await createAllowedKey("test")
    expect(res.key).toMatch(/^ss_live_use_/)
  })

  it("falls back to the default region on an unknown region code", async () => {
    homeRegionResult = { data: { home_region: "mars" }, error: null }
    const res = await createAllowedKey("test")
    expect(res.key).toMatch(/^ss_live_use_/)
  })
})
