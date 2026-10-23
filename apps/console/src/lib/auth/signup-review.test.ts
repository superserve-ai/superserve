import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  isSignupReviewBlocked,
  signupReviewStartsAt,
  signupReviewStatus,
} from "./signup-review"

const after = "2026-03-01T00:00:00Z"

function account(overrides: Record<string, unknown> = {}) {
  return {
    email: "new-user@example.com",
    created_at: after,
    app_metadata: { provider: "email", providers: ["email"] },
    ...overrides,
  }
}

describe("signup review status", () => {
  beforeEach(() => {
    vi.stubEnv("SIGNUP_REVIEW_STARTS_AT", "2026-01-01T00:00:00Z")
    vi.stubEnv("STAFF_EMAIL_DOMAIN", "staff.example.com")
  })
  afterEach(() => vi.unstubAllEnvs())

  it("treats an unmarked account created since review started as pending", () => {
    expect(signupReviewStatus(account())).toBe("pending")
    expect(isSignupReviewBlocked(account())).toBe(true)
  })

  it("leaves unmarked accounts created before review started ungated", () => {
    const existing = account({ created_at: "2025-12-31T23:59:59Z" })
    expect(signupReviewStatus(existing)).toBeUndefined()
    expect(isSignupReviewBlocked(existing)).toBe(false)
  })

  it("follows a recorded decision whenever the account was created", () => {
    const approved = account({
      app_metadata: { provider: "email", signup_review: "approved" },
    })
    expect(signupReviewStatus(approved)).toBe("approved")
    expect(isSignupReviewBlocked(approved)).toBe(false)
    const rejected = account({
      created_at: "2025-01-01T00:00:00Z",
      app_metadata: { provider: "email", signup_review: "rejected" },
    })
    expect(isSignupReviewBlocked(rejected)).toBe(true)
  })

  it.each([
    ["an invited teammate", { invited_at: after }],
    [
      "staff",
      {
        email: "person@staff.example.com",
        app_metadata: { provider: "google", providers: ["google"] },
      },
    ],
  ])("does not hold %s", (_label, overrides) => {
    expect(isSignupReviewBlocked(account(overrides))).toBe(false)
  })

  it.each([
    undefined,
    "",
    "not a date",
    "1",
    "10/23/2026",
    "2026-10-23T00:00:00",
  ])("refuses to decide without a valid start (%s)", (raw) => {
    vi.stubEnv("SIGNUP_REVIEW_STARTS_AT", raw as string)
    expect(() => signupReviewStartsAt()).toThrow("SIGNUP_REVIEW_STARTS_AT")
    expect(() => isSignupReviewBlocked(account())).toThrow()
  })
})
