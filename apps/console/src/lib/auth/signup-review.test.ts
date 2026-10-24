import { describe, expect, it } from "vitest"

import {
  assertSignupReviewCleared,
  isSignupReviewBlocked,
  SignupReviewPendingError,
  signupReviewStatus,
} from "./signup-review"

const account = (signup_review?: string) => ({
  app_metadata: signup_review ? { signup_review } : {},
})

describe("signup review", () => {
  it("never gates an account without a recorded decision", () => {
    expect(signupReviewStatus(account())).toBeUndefined()
    expect(isSignupReviewBlocked(account())).toBe(false)
    expect(isSignupReviewBlocked(null)).toBe(false)
    expect(() => assertSignupReviewCleared(account())).not.toThrow()
  })

  it.each(["pending", "rejected"])("blocks a %s account", (status) => {
    expect(isSignupReviewBlocked(account(status))).toBe(true)
    expect(() => assertSignupReviewCleared(account(status))).toThrow(
      SignupReviewPendingError,
    )
  })

  it("lets an approved account through", () => {
    expect(signupReviewStatus(account("approved"))).toBe("approved")
    expect(isSignupReviewBlocked(account("approved"))).toBe(false)
  })

  it("ignores unknown values", () => {
    expect(signupReviewStatus(account("held"))).toBeUndefined()
  })
})
