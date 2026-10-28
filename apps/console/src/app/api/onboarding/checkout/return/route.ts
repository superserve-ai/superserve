import { NextResponse } from "next/server"

import { confirmSignupCheckout } from "@/lib/api/signup-checkout"
import {
  planPickerPath,
  signupCheckoutReturnPath,
} from "@/lib/billing/signup-checkout-paths"
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
  let target: string
  try {
    target = await confirmSignupCheckout(user, account, team)
  } catch {
    target =
      account && team
        ? planPickerPath("payment_confirming", undefined, { account, team })
        : planPickerPath("checkout_elsewhere")
  }
  return NextResponse.redirect(new URL(target, origin))
}
