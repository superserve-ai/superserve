import "server-only"
import { z } from "zod"

import { ycAccount, ycTeams } from "@/lib/yc-claims"

import { journeyEnabled } from "./acceptance-api"
import { AcceptanceError, postYCAccount } from "./customer-request"
import { claimID } from "./staff-schema"

const inputSchema = z
  .object({
    claim_id: claimID,
    team: z.string().min(1),
    request_id: claimID,
    verification_link: z.string().url().max(2048),
  })
  .strict()
export async function requestIdentityReview(
  input: z.infer<typeof inputSchema>,
) {
  if (!journeyEnabled()) throw new AcceptanceError("unavailable")
  const parsed = inputSchema.parse(input)
  const user = await ycAccount()
  if (!user) throw new AcceptanceError("signin")
  const teams = await ycTeams(user)
  const team = teams.find(
    (value) => `${value.region}:${value.teamId}` === parsed.team,
  )
  if (!team) throw new AcceptanceError("forbidden")
  const result = z
    .object({
      state: z.literal("review_required"),
      claim_id: claimID,
      team_id: claimID,
      home_region: z.string(),
      review_request_id: claimID,
      review_revision: z.number().int().nonnegative().safe(),
    })
    .parse(
      await postYCAccount(user.id, team.region, "offers", "review", {
        claim_id: parsed.claim_id,
        team_id: team.teamId,
        request_id: parsed.request_id,
        verification_link: parsed.verification_link,
      }),
    )
  if (
    result.claim_id !== parsed.claim_id ||
    result.team_id !== team.teamId ||
    result.home_region !== team.region ||
    result.review_request_id !== parsed.request_id
  )
    throw new AcceptanceError("conflict")
  return { state: result.state }
}
