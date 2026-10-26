import type { User } from "@supabase/supabase-js"

// Review state lives in app_metadata, which only the service role can write.
// Enterprise applicants awaiting a pricing decision are blocked until a strict
// catalog read resolves legacy admission or pricing v2 staff approval.
export type SignupReviewStatus = "pending" | "approved" | "rejected"

export const SIGNUP_REVIEW_PENDING_MESSAGE =
  "Your Enterprise account is being set up. We'll email you as soon as it's ready."

type MetadataUser = Pick<User, "app_metadata"> | null | undefined

export function signupReviewStatus(
  user: MetadataUser,
): SignupReviewStatus | undefined {
  const status = user?.app_metadata?.signup_review
  return status === "pending" || status === "approved" || status === "rejected"
    ? status
    : undefined
}

export function hasPendingEnterprisePricing(user: MetadataUser): boolean {
  return (
    user?.app_metadata?.signup_enterprise_pricing_pending === true &&
    signupReviewStatus(user) !== "approved"
  )
}

/** Pending and rejected accounts get the same treatment, so neither is revealed. */
export function isSignupReviewBlocked(user: MetadataUser): boolean {
  const status = signupReviewStatus(user)
  return (
    status === "pending" ||
    status === "rejected" ||
    hasPendingEnterprisePricing(user)
  )
}

export class SignupReviewPendingError extends Error {
  constructor() {
    super(SIGNUP_REVIEW_PENDING_MESSAGE)
    this.name = "SignupReviewPendingError"
  }
}

export function assertSignupReviewCleared(user: MetadataUser): void {
  if (isSignupReviewBlocked(user)) throw new SignupReviewPendingError()
}
