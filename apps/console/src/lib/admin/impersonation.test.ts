import type { User } from "@supabase/supabase-js"
import { afterEach, describe, expect, it, vi } from "vitest"

const cookieStore = { value: undefined as string | undefined }
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (_: string) =>
      cookieStore.value ? { value: cookieStore.value } : undefined,
    set: () => {},
    delete: () => {
      cookieStore.value = undefined
    },
  }),
}))

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({
        data: {
          user: {
            id: "a1",
            email: "amit@superserve.ai",
            app_metadata: { provider: "google" },
          } as User,
        },
      })),
    },
  })),
}))

const teamLookup = vi.hoisted(() => ({
  result: { data: { name: "Acme Corp" }, error: null } as {
    data: { name: string } | null
    error: { message: string } | null
  },
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => teamLookup.result,
        }),
      }),
    }),
  }),
}))

import {
  getImpersonationContext,
  getImpersonationTeamId,
  signImpersonationToken,
  verifyImpersonationToken,
} from "./impersonation"

const TEAM = "11111111-1111-1111-1111-111111111111"
const staff = {
  id: "a1",
  email: "amit@superserve.ai",
  app_metadata: { provider: "google" },
} as User
const customer = {
  id: "c1",
  email: "joe@gmail.com",
  app_metadata: { provider: "google" },
} as User

afterEach(() => {
  cookieStore.value = undefined
  teamLookup.result = { data: { name: "Acme Corp" }, error: null }
})

describe("impersonation token", () => {
  it("round-trips a valid unexpired token", () => {
    const exp = 10_000
    const token = signImpersonationToken(TEAM, exp)
    expect(verifyImpersonationToken(token, 9_000)).toBe(TEAM)
  })
  it("rejects an expired token", () => {
    const token = signImpersonationToken(TEAM, 1_000)
    expect(verifyImpersonationToken(token, 2_000)).toBeNull()
  })
  it("rejects a tampered team id", () => {
    const token = signImpersonationToken(TEAM, 10_000)
    const forged = token.replace(TEAM, "22222222-2222-2222-2222-222222222222")
    expect(verifyImpersonationToken(forged, 9_000)).toBeNull()
  })
  it("rejects malformed input", () => {
    expect(verifyImpersonationToken(undefined, 0)).toBeNull()
    expect(verifyImpersonationToken("a.b", 0)).toBeNull()
  })
})

describe("getImpersonationTeamId", () => {
  it("returns the team for a staff user with a valid cookie", async () => {
    cookieStore.value = signImpersonationToken(TEAM, Date.now() + 60_000)
    expect(await getImpersonationTeamId(staff)).toBe(TEAM)
  })
  it("returns null for a non-staff user even with a valid cookie", async () => {
    cookieStore.value = signImpersonationToken(TEAM, Date.now() + 60_000)
    expect(await getImpersonationTeamId(customer)).toBeNull()
  })
  it("returns null when no cookie is present", async () => {
    expect(await getImpersonationTeamId(staff)).toBeNull()
  })
})

describe("getImpersonationContext", () => {
  it("returns null when no impersonation cookie is present", async () => {
    // cookieStore.value is undefined (no cookie) — the user is staff (mocked as amit@superserve.ai)
    expect(await getImpersonationContext()).toBeNull()
  })

  it("returns the team name when the lookup succeeds", async () => {
    cookieStore.value = signImpersonationToken(TEAM, Date.now() + 60_000)
    expect(await getImpersonationContext(staff)).toEqual({
      teamId: TEAM,
      teamName: "Acme Corp",
    })
  })

  it("fails safe to a fallback name when the team lookup errors", async () => {
    // The banner must never silently vanish while impersonation is still active.
    cookieStore.value = signImpersonationToken(TEAM, Date.now() + 60_000)
    teamLookup.result = { data: null, error: { message: "db down" } }
    expect(await getImpersonationContext(staff)).toEqual({
      teamId: TEAM,
      teamName: "another team",
    })
  })
})
