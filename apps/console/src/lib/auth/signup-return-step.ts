import {
  proAuthReturnPath,
  signupPreparationReturnPath,
  starterAuthReturnPath,
} from "@/lib/billing/pro-auth-return"
import {
  isPlanPickerPath,
  isSignupCheckoutPath,
  isSignupCheckoutReturnPath,
} from "@/lib/billing/signup-checkout-paths"
import { ycReturnPath } from "@/lib/yc/return-path"
import { staffReturnPath } from "@/lib/yc/staff-return-path"

import { inviteReturnPath } from "./invite-return-path"
import { SIGNUP_OFFER_DESTINATIONS, type SignupOffer } from "./signup-offer"

export interface SignupReturnStepOptions {
  signupOffer?: SignupOffer
  /** The link named a next path other than "/". */
  nextRequested: boolean
  newSignup: boolean
  /** The yc_claim_confirmation cookie is set. */
  ycClaimPending: boolean
}

// The step /auth/callback picks for a signed-in account from its next path,
// before a new pricing v2 sign-up's team entry state applies (see
// signupStepUsesEntryState). A sign-up tab that follows a confirmation done in
// another tab uses it too, so both tabs reach the same step.
export function signupReturnStep(
  next: string,
  {
    signupOffer,
    nextRequested,
    newSignup,
    ycClaimPending,
  }: SignupReturnStepOptions,
): string {
  const proNext = proAuthReturnPath(next) ?? starterAuthReturnPath(next)
  const preparationNext = signupPreparationReturnPath(next)
  const inviteNext = inviteReturnPath(next)
  const ycNext =
    ycReturnPath(next) ??
    (process.env.YC_STAFF_UI_ENABLED === "true" ? staffReturnPath(next) : null)
  if (
    !next.startsWith("/device") &&
    !next.startsWith("https://") &&
    !/^\/onboarding\/(?:plan|payment)\/?(?:\?|$)/.test(next) &&
    !isSignupCheckoutPath(next) &&
    !isSignupCheckoutReturnPath(next) &&
    !isPlanPickerPath(next) &&
    !ycNext &&
    !proNext &&
    !preparationNext &&
    !inviteNext
  ) {
    next = "/sandboxes"
  }
  if (inviteNext) next = inviteNext
  if (ycNext) next = ycNext
  if (proNext) next = proNext
  if (preparationNext) next = preparationNext
  if (next === "/sandboxes" && ycClaimPending) next = "/yc/claim"
  if (
    signupOffer &&
    next === "/sandboxes" &&
    !nextRequested &&
    (newSignup || signupOffer !== "enterprise")
  )
    next = SIGNUP_OFFER_DESTINATIONS[signupOffer]
  return next
}

// Whether a new pricing v2 sign-up's team entry state (trial, plan picker,
// payment wait) replaces this step: the console home or the offer's landing.
export function signupStepUsesEntryState(
  next: string,
  signupOffer: SignupOffer | undefined,
): boolean {
  return (
    next === "/sandboxes" ||
    (!!signupOffer && next === SIGNUP_OFFER_DESTINATIONS[signupOffer])
  )
}
