"use server"

import { settleSignupCheckout } from "@/lib/api/signup-checkout"
import { signupCheckoutReturnPath } from "@/lib/billing/signup-checkout-paths"
import { createServerClient } from "@/lib/supabase/server"

export async function checkSignupPaymentAction(
  account: string,
  team: string,
): Promise<string | null> {
  const {
    data: { user },
  } = await (await createServerClient()).auth.getUser()
  if (!user)
    return `/auth/signin?${new URLSearchParams({ next: signupCheckoutReturnPath(account, team) })}`
  return settleSignupCheckout(user, account, team)
}
