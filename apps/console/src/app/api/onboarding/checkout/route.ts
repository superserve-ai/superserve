import { NextResponse } from "next/server"

import { startSignupCheckout } from "@/lib/api/signup-checkout"
import {
  checkoutLocator,
  isSignupCheckoutOffer,
  planPickerPath,
} from "@/lib/billing/signup-checkout-paths"
import { createServerClient } from "@/lib/supabase/server"

// GET resumes the plan checkout of a team that has not paid yet. A
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
  const locator = checkoutLocator(searchParams)
  if (!locator)
    return NextResponse.redirect(
      new URL(planPickerPath("checkout_elsewhere"), origin),
      303,
    )
  if (!isSignupCheckoutOffer(offer))
    return NextResponse.redirect(
      new URL(planPickerPath("upgrade", undefined, locator), origin),
      303,
    )
  const {
    data: { user },
  } = await (await createServerClient()).auth.getUser()
  if (!user)
    return NextResponse.redirect(
      new URL(
        `/auth/signin?${new URLSearchParams({ next: planPickerPath("upgrade", offer, locator) })}`,
        origin,
      ),
      303,
    )
  let target: string
  try {
    target =
      (await startSignupCheckout(user, offer, origin, locator, switchPlan)) ??
      "/sandboxes"
  } catch {
    target = planPickerPath("checkout_unavailable", offer, locator)
  }
  return NextResponse.redirect(new URL(target, origin), 303)
}
