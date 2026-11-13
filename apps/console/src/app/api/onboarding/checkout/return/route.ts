import { NextResponse } from "next/server"

import { settleSignupCheckout } from "@/lib/api/signup-checkout"
import {
  paymentSettlingPath,
  planPickerPath,
  signupCheckoutReturnPath,
} from "@/lib/billing/signup-checkout-paths"
import { isOperatorView, recordCheckoutReturned } from "@/lib/posthog/checkout"
import { createServerClient } from "@/lib/supabase/server"

export async function GET(request: Request) {
  const { origin, searchParams } = new URL(request.url)
  const account = searchParams.get("account")
  const team = searchParams.get("team")
  const {
    data: { user },
  } = await (await createServerClient()).auth.getUser()
  if (!user)
    return NextResponse.redirect(
      new URL(
        `/auth/signin?${new URLSearchParams({ next: signupCheckoutReturnPath(account ?? "", team ?? "") })}`,
        origin,
      ),
    )
  // Stripe sends the customer here only after a successful payment.
  const counted = account === user.id && !(await isOperatorView(user))
  // returned=1 lets the payment page record the completion: this return is
  // already recorded, so the completion comes after it.
  const settling =
    account && team
      ? `${paymentSettlingPath({ account, team })}${counted ? "&returned=1" : ""}`
      : planPickerPath("checkout_elsewhere")
  if (counted)
    recordCheckoutReturned({
      userId: user.id,
      surface: "plan_picker",
      outcome: "success",
      teamKey: team,
    })
  let target: string
  try {
    target = (await settleSignupCheckout(user, account, team)) ?? settling
  } catch {
    target = settling
  }
  return NextResponse.redirect(new URL(target, origin))
}
