"use server"

import { getAuthApiKeyAndTeamForUser } from "@/lib/api/proxy-auth"
import { cellFor } from "@/lib/cells"
import { createServerClient } from "@/lib/supabase/server"

import {
  type BillingOffer,
  billingOffersSchema,
  type PlanCard,
  planCardsSchema,
} from "./plans"
import type { CheckoutLocator } from "./signup-checkout-paths"

export interface TeamCatalog {
  offers: BillingOffer[]
  cards: PlanCard[]
}

// The catalog offers and plan cards of the team a picker was shown for, or
// null when they can't be read for it and the picker should keep its default
// plans. Another account, or a session whose active team changed, gets none.
export async function getTeamCatalogAction(
  locator?: CheckoutLocator | null,
): Promise<TeamCatalog | null> {
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
    const body = (await response.json()) as {
      offers?: unknown
      catalog?: unknown
    }
    return {
      offers: billingOffersSchema.parse(body.offers),
      cards: planCardsSchema.parse(
        (body.catalog as { cards?: unknown } | undefined)?.cards,
      ),
    }
  } catch {
    return null
  }
}

export async function getTeamOffersAction(
  locator?: CheckoutLocator | null,
): Promise<BillingOffer[] | null> {
  return (await getTeamCatalogAction(locator))?.offers ?? null
}
