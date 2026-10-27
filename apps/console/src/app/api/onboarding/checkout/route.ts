import { NextResponse } from "next/server"

import { startSignupCheckout } from "@/lib/api/signup-checkout"
import {
  isSignupCheckoutOffer,
  signupCheckoutPath,
  signupCheckoutRetryPath,
} from "@/lib/billing/signup-checkout-paths"
import { createServerClient } from "@/lib/supabase/server"

// GET resumes the plan checkout of a team still waiting for payment. A
// same-origin POST is an explicit plan choice and may replace an open
// checkout for another plan.
export async function GET(request: Request) {
  return checkout(request, false)
}

export async function POST(request: Request) {
  const { origin } = new URL(request.url)
  if (request.headers.get("origin") !== origin)
    return new NextResponse(null, { status: 403 })
  return checkout(request, true)
}

async function checkout(request: Request, switchPlan: boolean) {
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
    target =
      (await startSignupCheckout(user, offer, origin, switchPlan)) ??
      "/sandboxes"
  } catch {
    target = signupCheckoutRetryPath(offer)
  }
  return NextResponse.redirect(new URL(target, origin), 303)
}
