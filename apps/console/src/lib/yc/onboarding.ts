import "server-only"
import { z } from "zod"

import type { SignupPlanContext } from "@/lib/api/signup-plan"
import { ycRequest } from "@/lib/yc-claims"

import { journeyEnabled } from "./acceptance-api"
import { claimRoute } from "./claim-route"
import { claimID } from "./staff-schema"

export async function ycOnboardingDestination(
  context: SignupPlanContext,
): Promise<string | null> {
  if (!journeyEnabled()) return null
  const result = z
    .object({
      claims: z.array(
        z.object({
          id: claimID,
          state: z.string(),
          team_id: claimID.nullable(),
          home_region: z.string().nullable(),
        }),
      ),
    })
    .parse(await ycRequest("claims", { user_id: context.userId }))
  const bound = result.claims.find(
    (claim) =>
      claim.state === "bound" &&
      `${claim.home_region}:${claim.team_id}` === context.teamKey,
  )
  if (bound) {
    const route = await claimRoute(
      {
        id: bound.id,
        team_id: bound.team_id!,
        home_region: bound.home_region!,
      },
      context.userId,
    )
    return route.acceptance ? `/yc/accept?claim=${bound.id}` : "/yc/claim"
  }
  if (
    result.claims.some(
      (claim) =>
        !claim.team_id &&
        ["confirmed", "manual_review", "awaiting_confirmation"].includes(
          claim.state,
        ),
    )
  )
    return "/yc/claim"
  return null
}
