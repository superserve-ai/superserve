"use server"

import { cookies } from "next/headers"

import { signupEntryDestination } from "@/lib/api/signup-checkout"
import { getSignupPlanAction } from "@/lib/api/signup-plan-actions"
import { SignupSetupBlockedError } from "@/lib/api/signup-setup-error"
import { SignupRestrictedError } from "@/lib/auth/signup-restrictions"
import type { PricingVersion } from "@/lib/billing/plans"
import { getPublicBillingPlansAction } from "@/lib/billing/plans-actions"
import {
  proAuthReturnPath,
  starterAuthReturnPath,
} from "@/lib/billing/pro-auth-return"
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
  // No user here can be a failed lookup with the session intact. Fail, so the
  // tab takes its own fallback for the account it saw sign in.
  if (!user) throw new Error("No signed-in user to follow")
  const ycClaimPending = !!(await cookies()).get(YC_COOKIE)
  const stepFor = (pricing: PricingVersion) => {
    const signupOffer =
      rawOffer && (isSelfServeSignupOffer(rawOffer) || pricing === "v2")
        ? parseSignupOffer(rawOffer)
        : undefined
    const step = signupReturnStep(requested, {
      signupOffer,
      nextRequested: requested !== "/",
      newSignup: true,
      ycClaimPending,
    })
    return { signupOffer, step }
  }
  // The callback falls back to legacy pricing when it cannot read it, but
  // its read may have worked. When this one fails, keep only a step both
  // pricing versions agree on and the team state cannot change; otherwise
  // take the dashboard entry rather than guess.
  const pricing = await getPublicBillingPlansAction().then(
    (plans) => plans.pricing_version,
    () => null,
  )
  // As the callback does, a payment step needs the first team set up first;
  // otherwise the dashboard's generic preparation drops the payment page.
  // When that setup fails, take the callback's account-bound recovery.
  const paidSetupRecovery = async (step: string) => {
    if (!proAuthReturnPath(step) && !starterAuthReturnPath(step)) return null
    try {
      await getSignupPlanAction(
        new URL(step, "https://console.superserve.ai").searchParams.get(
          "team",
        ) ?? undefined,
        user.id,
        undefined,
        step,
      )
      return null
    } catch (error) {
      // A restricted sign-up gets the callback's restriction notice, not a
      // setup retry.
      if (error instanceof SignupRestrictedError)
        return "/auth/auth-code-error?reason=signup_blocked"
      return `/auth/auth-code-error?${new URLSearchParams({
        reason:
          error instanceof SignupSetupBlockedError
            ? error.reason
            : "account_setup",
        account: user.id,
        next: step,
      })}`
    }
  }
  if (!pricing) {
    const legacy = stepFor("legacy")
    const v2 = stepFor("v2")
    if (
      v2.signupOffer === "enterprise" ||
      legacy.step !== v2.step ||
      signupStepUsesEntryState(v2.step, v2.signupOffer)
    )
      return "/"
    return confirmedSignupReturnPath(
      (await paidSetupRecovery(v2.step)) ?? v2.step,
    )
  }
  const { signupOffer, step } = stepFor(pricing)
  // The callback alone puts a new Enterprise account on hold. This tab only
  // follows it, and the dashboard routes whatever state that left.
  if (signupOffer === "enterprise") return "/"
  const recovery = await paidSetupRecovery(step)
  if (recovery) return confirmedSignupReturnPath(recovery)
  if (pricing !== "v2" || !signupStepUsesEntryState(step, signupOffer))
    return confirmedSignupReturnPath(step)
  const checkoutOffer = isSignupCheckoutOffer(signupOffer)
    ? signupOffer
    : undefined
  // A failed lookup here says nothing about the one the callback made, which
  // may have swapped the offer's landing page for the console, so take the
  // dashboard entry rather than guess. A null answer means the team awaits no
  // plan, and the callback keeps its step for that too.
  const entry = await signupEntryDestination(user, checkoutOffer).then(
    (path) => path ?? step,
    () => "/",
  )
  return confirmedSignupReturnPath(entry)
}
