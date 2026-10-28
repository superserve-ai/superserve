"use server"

import { getAuthApiKeyAndTeamForUser } from "@/lib/api/proxy-auth"
import { cellFor } from "@/lib/cells"
import { createServerClient } from "@/lib/supabase/server"

import { type BillingOffer, billingOffersSchema } from "./plans"

// The signed-in team's catalog offers, or null when they can't be read and
// the picker should keep its default plans.
export async function getTeamOffersAction(): Promise<BillingOffer[] | null> {
  try {
    const {
      data: { user },
    } = await (await createServerClient()).auth.getUser()
    if (!user) return null
    const { apiKey, team } = await getAuthApiKeyAndTeamForUser(user)
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
