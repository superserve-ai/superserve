import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: { id: "u1", email: "pavitra@superserve.ai" } },
      }),
    },
  }),
}))

// No cookie set: active-team resolution falls back to the first membership.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}))

const mockPublishPromotionIdentity = vi.fn(async (..._args: unknown[]) => {})
let uswProfileExists = true
let uswProfileChecked = false
let insertedApiKeyRow: Record<string, unknown> | null = null
let revokedApiKeyRow: Record<string, unknown> | null = null
let revokedKeyFilters: Array<[string, string]> = []

// Default cell: the user's profile exists, but their team lives elsewhere.
const useClient = {
  from: vi.fn((table: string) => {
    if (table === "profile") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: uswProfileExists ? { id: "u1" } : null,
              error: null,
            }),
          }),
        }),
      }
    }
    if (table === "team_memberships") {
      return {
        select: () => ({
          eq: async () => ({ data: [], error: null }),
        }),
      }
    }
    if (table === "team_member") {
      return {
        select: () => ({ eq: async () => ({ data: [], error: null }) }),
      }
    }
    throw new Error(`unexpected table ${table} in use cell`)
  }),
}

// usw cell: holds the membership, the team row, and receives the key insert.
const uswClient = {
  from: vi.fn((table: string) => {
    if (table === "team_memberships") {
      return {
        select: () => ({
          eq: async () => ({ data: [], error: null }),
        }),
      }
    }
    if (table === "team_member") {
      return {
        select: () => ({
          eq: async () => ({ data: [{ team_id: "team-west" }], error: null }),
        }),
      }
    }
    if (table === "team") {
      return {
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: { home_region: "usw" },
              error: null,
            }),
          }),
        }),
      }
    }
    if (table === "profile") {
      // ensureProfile now runs in the team's cell before the key insert —
      // report the profile as present so the write path proceeds.
      uswProfileChecked = true
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: uswProfileExists ? { id: "u1" } : null,
              error: null,
            }),
          }),
        }),
      }
    }
    if (table === "api_key") {
      return {
        select: () => ({
          eq: () => ({
            is: () => ({
              neq: () => ({
                order: async () => ({
                  data: [
                    {
                      id: "k1",
                      name: "test",
                      key_hash: "12345678abcdef",
                      created_at: "2026-07-01",
                      last_used_at: null,
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          }),
        }),
        update: (row: Record<string, unknown>) => {
          revokedApiKeyRow = row
          return {
            eq: (column: string, value: string) => {
              revokedKeyFilters = [[column, value]]
              return {
                eq: async (nextColumn: string, nextValue: string) => {
                  revokedKeyFilters.push([nextColumn, nextValue])
                  return { error: null }
                },
              }
            },
          }
        },
        insert: (row: Record<string, unknown>) => {
          insertedApiKeyRow = row
          return {
            select: () => ({
              single: async () => ({
                data: { id: "k1", name: "test", created_at: "2026-07-01" },
                error: null,
              }),
            }),
          }
        },
      }
    }
    throw new Error(`unexpected table ${table} in usw cell`)
  }),
}

vi.mock("@/lib/api/promotion-identity", () => ({
  publishPromotionIdentity: (...args: unknown[]) =>
    mockPublishPromotionIdentity(...args),
}))
vi.mock("@/lib/cells", () => ({
  DEFAULT_REGION: "use",
  configuredRegions: () => ["use", "usw"],
  cellFor: (region: string) => ({
    region,
    apiBaseUrl: `https://api-${region}.test`,
    createAdminClient: () => (region === "usw" ? uswClient : useClient),
  }),
}))

import {
  createApiKeyAction,
  listApiKeysAction,
  revokeApiKeyAction,
} from "./api-keys-actions"

describe("createApiKeyAction cell targeting", () => {
  it("writes the key row to the team's home cell", async () => {
    const res = await createApiKeyAction("test")

    expect(res.key).toMatch(/^ss_live_usw_/)
    expect(uswProfileChecked).toBe(true)
    expect(insertedApiKeyRow).toMatchObject({
      team_id: "team-west",
      name: "test",
      created_by: "u1",
    })
    expect(mockPublishPromotionIdentity).not.toHaveBeenCalled()
    // The default cell only saw membership fan-out.
    const useTables = useClient.from.mock.calls.map(([table]) => table)
    expect(useTables).not.toContain("api_key")
  })

  it("publishes profile and evidence in the home cell when a creator profile is missing", async () => {
    uswProfileExists = false
    try {
      await createApiKeyAction("missing-profile")
      expect(mockPublishPromotionIdentity).toHaveBeenCalledWith(
        "usw",
        "u1",
        expect.objectContaining({ email: "pavitra@superserve.ai" }),
        expect.any(String),
      )
    } finally {
      uswProfileExists = true
    }
  })

  it("does not insert a key when missing-profile publication fails", async () => {
    uswProfileExists = false
    insertedApiKeyRow = null
    mockPublishPromotionIdentity.mockRejectedValueOnce(
      new Error("publication failed"),
    )
    try {
      await expect(createApiKeyAction("missing-profile")).rejects.toThrow(
        "publication failed",
      )
      expect(mockPublishPromotionIdentity).toHaveBeenCalledWith(
        "usw",
        "u1",
        expect.objectContaining({ email: "pavitra@superserve.ai" }),
        expect.any(String),
      )
      expect(insertedApiKeyRow).toBeNull()
    } finally {
      uswProfileExists = true
    }
  })
})

describe("existing-team API-key actions", () => {
  it("lists keys when promotion publication is unavailable", async () => {
    mockPublishPromotionIdentity.mockClear()
    mockPublishPromotionIdentity.mockRejectedValueOnce(new Error("writer down"))
    try {
      await expect(listApiKeysAction()).resolves.toEqual([
        {
          id: "k1",
          name: "test",
          prefix: "12345678...",
          created_at: "2026-07-01",
          last_used_at: null,
        },
      ])
      expect(uswClient.from).toHaveBeenCalledWith("api_key")
      expect(mockPublishPromotionIdentity).not.toHaveBeenCalled()
    } finally {
      mockPublishPromotionIdentity.mockReset()
    }
  })

  it("revokes a team key when promotion publication is unavailable", async () => {
    mockPublishPromotionIdentity.mockClear()
    mockPublishPromotionIdentity.mockRejectedValueOnce(new Error("writer down"))
    revokedApiKeyRow = null
    revokedKeyFilters = []
    try {
      await expect(revokeApiKeyAction("k1")).resolves.toBeUndefined()
      expect(uswClient.from).toHaveBeenCalledWith("api_key")
      expect(revokedApiKeyRow).toEqual({
        revoked_at: expect.any(String),
      })
      expect(revokedKeyFilters).toEqual([
        ["id", "k1"],
        ["team_id", "team-west"],
      ])
      expect(mockPublishPromotionIdentity).not.toHaveBeenCalled()
    } finally {
      mockPublishPromotionIdentity.mockReset()
    }
  })
})
