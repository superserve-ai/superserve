/**
 * proxy-auth — pure helpers.
 *
 * These are the security-critical primitives used by every authenticated
 * request through the API proxy. Tests focus on:
 *  - Deterministic key derivation (same user → same key across instances)
 *  - Different users → different keys
 *  - CONSOLE_PROXY_SECRET length guard
 *  - hashKey stability
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Mock supabase clients so the proxy-auth module loads without a real
// connection. The pure helpers don't use them, but the module imports
// them at the top.
vi.mock("@superserve/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}))
vi.mock("@superserve/supabase/server", () => ({
  createServerClient: vi.fn(),
}))

import { deriveRawKey, getProxySecret, hashKey } from "./proxy-auth"

const ORIGINAL_SECRET = process.env.CONSOLE_PROXY_SECRET

describe("proxy-auth.getProxySecret", () => {
  afterEach(() => {
    process.env.CONSOLE_PROXY_SECRET = ORIGINAL_SECRET
  })

  it("returns the secret when set and long enough", () => {
    process.env.CONSOLE_PROXY_SECRET = "x".repeat(32)
    expect(getProxySecret()).toBe("x".repeat(32))
  })

  it("throws when the secret is missing", () => {
    process.env.CONSOLE_PROXY_SECRET = undefined
    expect(() => getProxySecret()).toThrow(/at least 32 characters/)
  })

  it("throws when the secret is shorter than 32 chars", () => {
    process.env.CONSOLE_PROXY_SECRET = "short"
    expect(() => getProxySecret()).toThrow(/at least 32 characters/)
  })
})

describe("proxy-auth.deriveRawKey", () => {
  beforeEach(() => {
    process.env.CONSOLE_PROXY_SECRET =
      "test-secret-must-be-at-least-thirty-two-chars-long-abcdef"
  })

  it("is deterministic: same user id always returns the same key", () => {
    const k1 = deriveRawKey("user-123")
    const k2 = deriveRawKey("user-123")
    expect(k1).toBe(k2)
  })

  it("produces different keys for different user ids", () => {
    const k1 = deriveRawKey("user-a")
    const k2 = deriveRawKey("user-b")
    expect(k1).not.toBe(k2)
  })

  it("prefixes the key with ss_live_", () => {
    expect(deriveRawKey("user-123")).toMatch(/^ss_live_/)
  })

  it("uses base64url alphabet (safe for headers/URLs)", () => {
    const key = deriveRawKey("user-123")
    // base64url never uses +, /, or padding =
    expect(key).not.toMatch(/[+/=]/)
  })

  it("changes when the secret changes (force rotation)", () => {
    const a = deriveRawKey("user-123")
    process.env.CONSOLE_PROXY_SECRET =
      "different-secret-must-also-be-long-aaaaaaa"
    const b = deriveRawKey("user-123")
    expect(a).not.toBe(b)
  })
})

describe("proxy-auth.hashKey", () => {
  it("is stable for the same input", () => {
    expect(hashKey("ss_live_abc")).toBe(hashKey("ss_live_abc"))
  })

  it("returns a hex string of 64 chars (sha256)", () => {
    const h = hashKey("ss_live_abc")
    expect(h).toMatch(/^[a-f0-9]{64}$/)
  })

  it("produces different hashes for different inputs", () => {
    expect(hashKey("a")).not.toBe(hashKey("b"))
  })
})
