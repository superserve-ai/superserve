"use server"

import {
  isSignupCheckoutOffer,
  SIGNUP_CHECKOUT_OFFERS,
} from "@/lib/billing/signup-checkout-paths"

import { recordCheckoutReturnForUser } from "./checkout"

// The plan picker is a client page, so it reports a cancelled Checkout here.
// The event is sent from the server, for the signed-in user and only for a
// team they belong to, like the rest of the checkout funnel.
export async function recordPlanPickerCancelAction(input: {
  account: string
  team: string
  offer: string | null
}): Promise<void> {
  if (!input || typeof input !== "object") return
  await recordCheckoutReturnForUser({
    surface: "plan_picker",
    outcome: "cancel",
    account: input.account ?? null,
    teamKey: input.team,
    offer: isSignupCheckoutOffer(input.offer)
      ? SIGNUP_CHECKOUT_OFFERS[input.offer]
      : null,
  })
}
