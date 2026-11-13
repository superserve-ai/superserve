"use server"

import { cookies } from "next/headers"

import { signupEntryDestination } from "@/lib/api/signup-checkout"
import { getPricingVersionAction } from "@/lib/billing/plans-actions"
import { isSignupCheckoutOffer } from "@/lib/billing/signup-checkout-paths"
import { createServerClient } from "@/lib/supabase/server"
import { YC_COOKIE } from "@/lib/yc-claims"

import { signupEmailNextPath } from "./signup-email-next"
import { isSelfServeSignupOffer, parseSignupOffer } from "./signup-offer"
import { confirmedSignupReturnPath } from "./signup-return-path"
import {
  signupReturnStep,
  signupStepUsesEntryState,
} from "./signup-return-step"

// Where a new account goes when its sign-up tab follows a confirmation done
// in another tab. It makes the same choice as /auth/callback for a new
// sign-up, so both tabs reach one step: the callback's step for the requested
// next path (signupReturnStep), and under pricing v2 the team's entry state
// when that step is the console home or the offer's landing page (a trial
// uses the console, an unpaid team goes to its plan picker).
export async function confirmedSignupDestinationAction(
  rawOffer: string | undefined,
  rawNext: string,
): Promise<string> {
  // The next path the confirmation email carried, which the callback used.
  const requested = confirmedSignupReturnPath(
    signupEmailNextPath(rawNext) ?? "/",
  )
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return requested
  const pricing = await getPricingVersionAction()
  const signupOffer =
    rawOffer && (isSelfServeSignupOffer(rawOffer) || pricing === "v2")
      ? parseSignupOffer(rawOffer)
      : undefined
  // The callback alone puts a new Enterprise account on hold. This tab only
  // follows it, and the dashboard routes whatever state that left.
  if (signupOffer === "enterprise") return "/"
  const step = signupReturnStep(requested, {
    signupOffer,
    nextRequested: requested !== "/",
    newSignup: true,
    ycClaimPending: !!(await cookies()).get(YC_COOKIE),
  })
  if (pricing !== "v2" || !signupStepUsesEntryState(step, signupOffer))
    return confirmedSignupReturnPath(step)
  const checkoutOffer = isSignupCheckoutOffer(signupOffer)
    ? signupOffer
    : undefined
  const entry = await signupEntryDestination(user, checkoutOffer).catch(
    () => null,
  )
  return confirmedSignupReturnPath(entry ?? step)
}
