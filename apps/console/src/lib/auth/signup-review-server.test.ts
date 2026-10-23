import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next/headers", () => ({ cookies: async () => new Map() }))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }))
vi.mock("@/lib/supabase/server", () => ({ createServerClient: vi.fn() }))

import { requiresSignupReview } from "./signup-review-server"

function account(overrides: Record<string, unknown> = {}) {
  return {
    email: "new-user@example.com",
    app_metadata: { provider: "google", providers: ["google"] },
    ...overrides,
  }
}

describe("requiresSignupReview", () => {
  beforeEach(() => vi.stubEnv("STAFF_EMAIL_DOMAIN", "staff.example.com"))
  afterEach(() => vi.unstubAllEnvs())

  it("holds a first-time account created since review started, however long ago", () => {
    vi.stubEnv("SIGNUP_REVIEW_STARTS_AT", "2026-01-01T00:00:00Z")
    expect(
      requiresSignupReview(account({ created_at: "2026-01-01T00:00:00Z" })),
    ).toBe(true)
    expect(
      requiresSignupReview(account({ created_at: "2026-03-01T00:00:00Z" })),
    ).toBe(true)
  })

  it("leaves accounts created before review started alone", () => {
    vi.stubEnv("SIGNUP_REVIEW_STARTS_AT", "2026-01-01T00:00:00Z")
    expect(
      requiresSignupReview(account({ created_at: "2025-12-31T23:59:59Z" })),
    ).toBe(false)
  })

  it.each([
    [
      "an already reviewed account",
      {
        app_metadata: { provider: "google", signup_review: "approved" },
      },
    ],
    ["an invited teammate", { invited_at: "2026-10-01T11:00:00Z" }],
    ["staff", { email: "person@staff.example.com" }],
  ])("lets %s through unchanged", (_label, overrides) => {
    vi.stubEnv("SIGNUP_REVIEW_STARTS_AT", "2026-01-01T00:00:00Z")
    expect(
      requiresSignupReview(
        account({ created_at: "2026-03-01T00:00:00Z", ...overrides }),
      ),
    ).toBe(false)
  })
})
