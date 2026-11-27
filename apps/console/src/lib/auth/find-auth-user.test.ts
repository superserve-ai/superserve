import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const mockFetch = vi.fn()
vi.mock("@/lib/supabase/fresh-fetch", () => ({
  supabaseFetch: (...args: unknown[]) => mockFetch(...args),
}))

import { findAuthUserByEmail } from "./find-auth-user"

const page = (users: Array<Record<string, unknown>>, status = 200) =>
  new Response(JSON.stringify({ users }), { status })

const filler = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: `other-${i}`,
    email: `xuser${i}@example.com`,
  }))

describe("findAuthUserByEmail", () => {
  beforeEach(() => {
    mockFetch.mockReset()
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co/")
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key")
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("asks the admin user list for the address with the service key", async () => {
    mockFetch.mockResolvedValue(page([]))

    await findAuthUserByEmail(" User@Example.com ")

    const [url, init] = mockFetch.mock.calls[0]
    const parsed = new URL(url)
    expect(parsed.origin + parsed.pathname).toBe(
      "https://project.supabase.co/auth/v1/admin/users",
    )
    expect(parsed.searchParams.get("filter")).toBe("user@example.com")
    expect(parsed.searchParams.get("page")).toBe("1")
    expect(init.headers).toEqual({
      apikey: "service-key",
      Authorization: "Bearer service-key",
    })
    expect(init.cache).toBe("no-store")
  })

  it("returns only an exact, case-insensitive email match", async () => {
    mockFetch.mockResolvedValue(
      page([
        { id: "a", email: "auser@example.com" },
        { id: "b", email: "user@example.com.evil" },
        { id: "c", email: "USER@example.com" },
      ]),
    )

    const user = await findAuthUserByEmail("user@example.com")

    expect(user?.id).toBe("c")
  })

  // The real user JSON has no is_sso_user field, only the identities.
  it("skips an SSO account with the same address", async () => {
    mockFetch.mockResolvedValue(
      page([
        {
          id: "sso",
          email: "user@example.com",
          app_metadata: { provider: "sso:provider-1" },
          identities: [{ provider: "sso:provider-1" }],
        },
        {
          id: "password",
          email: "user@example.com",
          app_metadata: { provider: "email" },
          identities: [{ provider: "email" }],
        },
      ]),
    )

    const user = await findAuthUserByEmail("user@example.com")

    expect(user?.id).toBe("password")
  })

  it("throws when two non-SSO accounts share the address", async () => {
    mockFetch.mockResolvedValue(
      page([
        { id: "a", email: "user@example.com" },
        { id: "b", email: "User@example.com" },
      ]),
    )

    await expect(findAuthUserByEmail("user@example.com")).rejects.toThrow(
      "more than one",
    )
  })

  it("escapes LIKE wildcards so they match only themselves", async () => {
    mockFetch.mockResolvedValue(page([]))

    await findAuthUserByEmail("first_last%x@example.com")

    expect(new URL(mockFetch.mock.calls[0][0]).searchParams.get("filter")).toBe(
      "first\\_last\\%x@example.com",
    )
  })

  it("returns null when no account matches", async () => {
    mockFetch.mockResolvedValue(page([{ id: "a", email: "x@example.com" }]))

    await expect(findAuthUserByEmail("user@example.com")).resolves.toBeNull()
    expect(mockFetch).toHaveBeenCalledOnce()
  })

  it("reads the next page when a full page has no exact match", async () => {
    mockFetch
      .mockResolvedValueOnce(page(filler(100)))
      .mockResolvedValueOnce(page([{ id: "u", email: "user@example.com" }]))

    const user = await findAuthUserByEmail("user@example.com")

    expect(user?.id).toBe("u")
    expect(new URL(mockFetch.mock.calls[1][0]).searchParams.get("page")).toBe(
      "2",
    )
  })

  it("throws instead of returning null when the lookup fails", async () => {
    mockFetch.mockResolvedValue(page([], 500))

    await expect(findAuthUserByEmail("user@example.com")).rejects.toThrow(
      "status 500",
    )
  })

  it("throws when too many accounts partly match", async () => {
    mockFetch.mockImplementation(async () => page(filler(100)))

    await expect(findAuthUserByEmail("user@example.com")).rejects.toThrow(
      "too many",
    )
    expect(mockFetch).toHaveBeenCalledTimes(10)
  })

  it("throws when the Supabase settings are missing", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "")

    await expect(findAuthUserByEmail("user@example.com")).rejects.toThrow(
      "Missing",
    )
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
