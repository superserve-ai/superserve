"use server"

import { getAuthApiKeyAndTeamForUser } from "@/lib/api/proxy-auth"
import { cellFor } from "@/lib/cells"
import { createServerClient } from "@/lib/supabase/server"

import { type BillingOffer, billingOffersSchema } from "./plans"
import type { CheckoutLocator } from "./signup-checkout-paths"

// The catalog offers of the team a picker was shown for, or null when they
// can't be read for it and the picker should keep its default plans. Another
// account, or a session whose active team changed, gets none.
export async function getTeamOffersAction(
  locator?: CheckoutLocator | null,
): Promise<BillingOffer[] | null> {
  try {
    const {
      data: { user },
    } = await (await createServerClient()).auth.getUser()
    if (!user || (locator && locator.account !== user.id)) return null
    const { apiKey, team } = await getAuthApiKeyAndTeamForUser(user)
    if (locator && locator.team !== `${team.region}:${team.teamId}`) return null
    const response = await fetch(
      new URL("/billing/capabilities", cellFor(team.region).apiBaseUrl),
      {
        headers: { "X-API-Key": apiKey },
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      },
    )
    if (!response.ok) return null
    const body = (await response.json()) as { offers?: unknown }
    return billingOffersSchema.parse(body.offers)
  } catch {
    return null
  }
}
