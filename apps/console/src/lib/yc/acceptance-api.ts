import "server-only"
import { z } from "zod"

import { ycAccount, ycRequest, ycTeams } from "@/lib/yc-claims"

import {
  acceptanceSchema,
  acceptInputSchema,
  type AcceptInput,
} from "./acceptance-schema"
import { financialAuthoritySchema } from "./financial-authority"
import { claimID } from "./staff-schema"

const accountClaim = z.object({
  id: claimID,
  state: z.string(),
  team_id: claimID.nullable(),
  home_region: z.string().nullable(),
  claimed_user_id: claimID.nullable(),
  financial_authority: financialAuthoritySchema.optional(),
})
import { AcceptanceError, postYCAccount } from "./customer-request"
export { AcceptanceError } from "./customer-request"
export class ClaimStateError extends AcceptanceError {
  constructor(
    public readonly state:
      | "rejected"
      | "revoked"
      | "financial_revocation_pending"
      | "financial_revoked"
      | "manual_review"
      | "awaiting_confirmation",
  ) {
    super("conflict")
  }
}

export function journeyEnabled() {
  return process.env.YC_CONSOLE_JOURNEY_ENABLED === "true"
}

export async function resolveAcceptedClaim(locator: string) {
  if (!journeyEnabled()) throw new AcceptanceError("unavailable")
  claimID.parse(locator)
  const user = await ycAccount()
  if (!user) throw new AcceptanceError("signin")
  const claims = z
    .object({ claims: z.array(accountClaim) })
    .parse(await ycRequest("claims", { user_id: user.id })).claims
  const claim = claims.find((value) => value.id === locator)
  if (
    claim &&
    !claim.financial_authority &&
    ["rejected", "revoked", "manual_review", "awaiting_confirmation"].includes(
      claim.state,
    )
  )
    throw new ClaimStateError(claim.state as ClaimStateError["state"])
  if (
    !claim ||
    claim.claimed_user_id !== user.id ||
    !claim.team_id ||
    !claim.home_region
  )
    throw new AcceptanceError("forbidden")
  const teams = await ycTeams(user)
  if (
    !teams.some(
      (team) =>
        team.teamId === claim.team_id && team.region === claim.home_region,
    )
  )
    throw new AcceptanceError("forbidden")
  if (claim.financial_authority?.state === "revocation_pending")
    throw new ClaimStateError("financial_revocation_pending")
  if (claim.financial_authority?.state === "revoked")
    throw new ClaimStateError("financial_revoked")
  if (claim.state !== "bound") throw new AcceptanceError("conflict")
  return { user, claim }
}

async function send(
  operation: "offer" | "accept" | "status",
  locator: string,
  fields: Record<string, unknown> = {},
) {
  const { user, claim } = await resolveAcceptedClaim(locator)
  const result = acceptanceSchema.parse(
    await postYCAccount(user.id, claim.home_region!, "offers", operation, {
      ...fields,
      claim_id: claim.id,
      team_id: claim.team_id,
    }),
  )
  if (
    result.claim_id !== claim.id ||
    result.user_id !== user.id ||
    result.team_id !== claim.team_id ||
    result.home_region !== claim.home_region
  )
    throw new AcceptanceError("forbidden")
  return result
}

export async function readOffer(locator: string) {
  return send("offer", locator)
}
export async function readOfferStatus(locator: string) {
  return send("status", locator)
}
export async function acceptOffer(input: AcceptInput) {
  const parsed = acceptInputSchema.parse(input)
  const result = await send("accept", parsed.claim_id, parsed)
  if (
    result.acceptance_id !== parsed.acceptance_id ||
    result.terms_digest !== parsed.terms_digest ||
    result.renewal_terms_digest !== parsed.renewal_terms_digest ||
    result.approval_revision !== parsed.approval_revision
  )
    throw new AcceptanceError("conflict")
  return result
}
