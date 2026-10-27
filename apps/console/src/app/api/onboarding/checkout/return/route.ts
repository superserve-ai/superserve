import { NextResponse } from "next/server"

import { confirmSignupCheckout } from "@/lib/api/signup-checkout"
import {
  planPickerPath,
  SIGNUP_CHECKOUT_RETURN_ROUTE,
} from "@/lib/billing/signup-checkout-paths"
import { createServerClient } from "@/lib/supabase/server"

export async function GET(request: Request) {
  const { origin } = new URL(request.url)
  const {
    data: { user },
  } = await (await createServerClient()).auth.getUser()
  if (!user)
    return NextResponse.redirect(
      new URL(
        `/auth/signin?${new URLSearchParams({ next: SIGNUP_CHECKOUT_RETURN_ROUTE })}`,
        origin,
      ),
    )
  let target: string
  try {
    target = await confirmSignupCheckout(user)
  } catch {
    target = planPickerPath("payment_confirming")
  }
  return NextResponse.redirect(new URL(target, origin))
}
