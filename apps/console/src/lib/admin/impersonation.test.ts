import type { User } from "@supabase/supabase-js"
import { afterEach, describe, expect, it, vi } from "vitest"

const cookieStore = {
  value: undefined as string | undefined,
  lastSet: null as null | {
    name: string
    value: string
    options: Record<string, unknown>
  },
}
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (_: string) =>
      cookieStore.value ? { value: cookieStore.value } : undefined,
    set: (name: string, value: string, options: Record<string, unknown>) => {
      cookieStore.lastSet = { name, value, options }
      // Emulate the browser: maxAge 0 expires the cookie, anything else stores it.
      cookieStore.value = options?.maxAge === 0 ? undefined : value
    },
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
          } as unknown as User,
        },
      })),
    },
  })),
}))

let teamLookupResult = {
  data: { name: "Acme Corp" },
  error: null,
} as {
  data: { name: string } | null
  error: { message: string } | null
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => teamLookupResult,
        }),
      }),
    }),
  }),
}))

import {
  clearImpersonationCookie,
  getImpersonationContext,
  getImpersonationTeamId,
  IMPERSONATION_COOKIE,
  signImpersonationToken,
  verifyImpersonationToken,
} from "./impersonation"

const TEAM = "11111111-1111-1111-1111-111111111111"
const staff = {
  id: "a1",
  email: "amit@superserve.ai",
  app_metadata: { provider: "google", permissions: ["platform:teams:read"] },
} as unknown as User
const customer = {
  id: "c1",
  email: "joe@gmail.com",
  app_metadata: { provider: "google", permissions: ["platform:teams:read"] },
} as unknown as User
const staffWithoutPermission = {
  id: "a2",
  email: "anya@superserve.ai",
  app_metadata: { provider: "google", permissions: [] },
} as unknown as User

afterEach(() => {
  cookieStore.value = undefined
  cookieStore.lastSet = null
  teamLookupResult = { data: { name: "Acme Corp" }, error: null }
  delete process.env.NEXT_PUBLIC_COOKIE_DOMAIN
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
  it("returns null for staff without platform:teams:read even with a valid cookie", async () => {
    cookieStore.value = signImpersonationToken(TEAM, Date.now() + 60_000)
    expect(await getImpersonationTeamId(staffWithoutPermission)).toBeNull()
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
    teamLookupResult = { data: null, error: { message: "db down" } }
    expect(await getImpersonationContext(staff)).toEqual({
      teamId: TEAM,
      teamName: "another team",
    })
  })
})

describe("clearImpersonationCookie", () => {
  it("expires the cookie with matching path + domain when NEXT_PUBLIC_COOKIE_DOMAIN is set", async () => {
    // Deleting by name alone would leave a domain-scoped cookie (e.g. on
    // `.superserve.ai`) in place, so Exit must expire it with the same options.
    process.env.NEXT_PUBLIC_COOKIE_DOMAIN = ".superserve.ai"
    cookieStore.value = signImpersonationToken(TEAM, Date.now() + 60_000)

    await clearImpersonationCookie()

    expect(cookieStore.lastSet?.name).toBe(IMPERSONATION_COOKIE)
    expect(cookieStore.lastSet?.options).toMatchObject({
      path: "/",
      domain: ".superserve.ai",
      maxAge: 0,
    })
    expect(cookieStore.value).toBeUndefined()
  })

  it("expires the cookie without a domain when NEXT_PUBLIC_COOKIE_DOMAIN is unset", async () => {
    cookieStore.value = signImpersonationToken(TEAM, Date.now() + 60_000)

    await clearImpersonationCookie()

    expect(cookieStore.lastSet?.options).toMatchObject({ path: "/", maxAge: 0 })
    expect(cookieStore.lastSet?.options.domain).toBeUndefined()
    expect(cookieStore.value).toBeUndefined()
  })
})
