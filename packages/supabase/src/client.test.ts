import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mockCreateBrowserClient = vi.fn()
vi.mock("@supabase/ssr", () => ({
  createBrowserClient: (...args: unknown[]) => mockCreateBrowserClient(...args),
}))

import { createBrowserClient } from "./client"

describe("createBrowserClient", () => {
  beforeEach(() => {
    mockCreateBrowserClient.mockReturnValue({})
  })

  afterEach(() => {
    mockCreateBrowserClient.mockReset()
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    delete process.env.NEXT_PUBLIC_COOKIE_DOMAIN
  })

  it("throws when NEXT_PUBLIC_SUPABASE_URL is missing", () => {
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-key"
    expect(() => createBrowserClient()).toThrow(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY",
    )
  })

  it("throws when NEXT_PUBLIC_SUPABASE_ANON_KEY is missing", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co"
    expect(() => createBrowserClient()).toThrow(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY",
    )
  })

  it("creates client with correct URL and key", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co"
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-key"

    createBrowserClient()

    expect(mockCreateBrowserClient).toHaveBeenCalledWith(
      "https://test.supabase.co",
      "test-key",
      {},
    )
  })

  it("passes cookie domain when NEXT_PUBLIC_COOKIE_DOMAIN is set", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co"
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-key"
    process.env.NEXT_PUBLIC_COOKIE_DOMAIN = ".example.com"

    createBrowserClient()

    expect(mockCreateBrowserClient).toHaveBeenCalledWith(
      "https://test.supabase.co",
      "test-key",
      { cookieOptions: { domain: ".example.com" } },
    )
  })
})
