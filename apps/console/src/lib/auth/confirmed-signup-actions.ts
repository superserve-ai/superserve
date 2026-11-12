"use server"

import { signupEntryDestination } from "@/lib/api/signup-checkout"
import { getPricingVersionAction } from "@/lib/billing/plans-actions"
import { isSignupCheckoutOffer } from "@/lib/billing/signup-checkout-paths"
import { createServerClient } from "@/lib/supabase/server"

import {
  isSelfServeSignupOffer,
  parseSignupOffer,
  SIGNUP_OFFER_DESTINATIONS,
} from "./signup-offer"
import { confirmedSignupReturnPath } from "./signup-return-path"

// Where a new account goes when its sign-up tab follows a confirmation done
// in another tab and the sign-up had no explicit next path. It makes the same
// choice as /auth/callback for a new sign-up, so both tabs reach one step:
// under pricing v2 the team's entry state decides (a trial uses the console,
// an unpaid team goes to its plan picker), else the offer's landing page.
export async function confirmedSignupDestinationAction(
  rawOffer: string | undefined,
): Promise<string> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return "/"
  const pricing = await getPricingVersionAction()
  const signupOffer =
    rawOffer && (isSelfServeSignupOffer(rawOffer) || pricing === "v2")
      ? parseSignupOffer(rawOffer)
      : undefined
  // The callback alone puts a new Enterprise account on hold. This tab only
  // follows it, and the dashboard routes whatever state that left.
  if (signupOffer === "enterprise") return "/"
  const fallback = signupOffer ? SIGNUP_OFFER_DESTINATIONS[signupOffer] : "/"
  if (pricing !== "v2") return fallback
  const checkoutOffer = isSignupCheckoutOffer(signupOffer)
    ? signupOffer
    : undefined
  const entry = await signupEntryDestination(user, checkoutOffer).catch(
    () => null,
  )
  return entry ? confirmedSignupReturnPath(entry) : fallback
}
