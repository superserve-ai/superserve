import { NextResponse } from "next/server"

import { settleSignupCheckout } from "@/lib/api/signup-checkout"
import {
  paymentSettlingPath,
  planPickerPath,
  signupCheckoutReturnPath,
} from "@/lib/billing/signup-checkout-paths"
import { recordCheckoutReturned } from "@/lib/posthog/checkout"
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
  const settling =
    account && team
      ? paymentSettlingPath({ account, team })
      : planPickerPath("checkout_elsewhere")
  // Stripe sends the customer here only after a successful payment.
  if (account === user.id)
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
