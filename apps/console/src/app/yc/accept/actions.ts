"use server"

import { redirect } from "next/navigation"

import { setActiveTeamAction } from "@/lib/api/teams-actions"
import {
  acceptOffer,
  ClaimStateError,
  AcceptanceError,
  readOfferStatus,
} from "@/lib/yc/acceptance-api"
import { resolveAcceptedClaim } from "@/lib/yc/acceptance-api"
import { acceptanceState, type AcceptInput } from "@/lib/yc/acceptance-schema"

export async function submitAcceptance(input: AcceptInput) {
  try {
    return { kind: "saved" as const, offer: await acceptOffer(input) }
  } catch (error) {
    if (error instanceof ClaimStateError)
      return { kind: "claim_state" as const, state: error.state }
    return {
      kind:
        error instanceof AcceptanceError
          ? error.kind
          : ("unavailable" as const),
    }
  }
}
export async function refreshAcceptance(claim: string) {
  try {
    return { kind: "saved" as const, offer: await readOfferStatus(claim) }
  } catch (error) {
    if (error instanceof ClaimStateError)
      return { kind: "claim_state" as const, state: error.state }
    return {
      kind:
        error instanceof AcceptanceError
          ? error.kind
          : ("unavailable" as const),
    }
  }
}

export async function openOfferBilling(claim: string) {
  const resolved = await resolveAcceptedClaim(claim)
  await setActiveTeamAction(
    resolved.claim.team_id!,
    resolved.claim.home_region!,
  )
  redirect("/plan-usage")
}

export async function openReadyOfferConsole(claim: string) {
  const offer = await readOfferStatus(claim)
  if (acceptanceState(offer) !== "funding_ready")
    throw new AcceptanceError("conflict")
  await setActiveTeamAction(offer.team_id, offer.home_region)
  redirect("/sandboxes")
}
