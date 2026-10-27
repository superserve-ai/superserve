import { NextResponse } from "next/server"

import { startSignupCheckout } from "@/lib/api/signup-checkout"
import {
  isSignupCheckoutOffer,
  signupCheckoutPath,
  signupCheckoutRetryPath,
} from "@/lib/billing/signup-checkout-paths"
import { createServerClient } from "@/lib/supabase/server"

// Resumes or starts the plan checkout of a team still waiting for payment,
// for retries after a cancelled or failed checkout.
export async function GET(request: Request) {
  const { origin, searchParams } = new URL(request.url)
  const offer = searchParams.get("offer")
  if (!isSignupCheckoutOffer(offer))
    return NextResponse.redirect(
      new URL("/auth/auth-code-error/?reason=plan_required", origin),
    )
  const {
    data: { user },
  } = await (await createServerClient()).auth.getUser()
  if (!user)
    return NextResponse.redirect(
      new URL(
        `/auth/signin?${new URLSearchParams({ next: signupCheckoutPath(offer) })}`,
        origin,
      ),
    )
  let target: string
  try {
    target = (await startSignupCheckout(user, offer, origin)) ?? "/sandboxes"
  } catch {
    target = signupCheckoutRetryPath(offer)
  }
  return NextResponse.redirect(new URL(target, origin))
}
