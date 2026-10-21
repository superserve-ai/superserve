import "server-only"
import { z } from "zod"

import { ycRequest } from "@/lib/yc-claims"

import { journeyEnabled, readOffer } from "./acceptance-api"

const billingStatus = z.object({
  state: z.string(),
  contract_id: z.string().uuid().nullish(),
})

// New admission understands preferred verified identities and rejects existing
// contracts. Preserve legacy billing status when new admission is unavailable.
export async function claimRoute(
  claim: {
    id: string
    team_id: string
    home_region: string
    automated?: boolean
  },
  user: string,
) {
  if (journeyEnabled()) {
    try {
      await readOffer(claim.id)
      return { state: "acceptance_required", acceptance: true }
    } catch {
      // Legacy contracts cannot enter the new-signup acceptance flow.
    }
  }
  if (claim.automated) return { state: "unavailable", acceptance: false }
  const status = billingStatus.parse(
    await ycRequest(
      "status",
      {
        id: claim.id,
        user_id: user,
        team_id: claim.team_id,
      },
      claim.home_region,
    ),
  )
  return {
    state: status.state,
    acceptance: false,
  }
}
