import "server-only"
import { cookies } from "next/headers"

import {
  parseSignupChoice,
  type SignupPlanContext,
} from "@/lib/api/signup-plan"
import type { TeamMembership } from "@/lib/api/team-directory"
import { PLAN_OFFER_COOKIE, readPlanOffer } from "@/lib/auth/plan-preselection"
import { cellFor } from "@/lib/cells"

// The caller must authenticate the user and resolve their team membership.
export async function readSignupPlan(
  userId: string,
  team: TeamMembership,
  expectedTeam?: string,
): Promise<SignupPlanContext> {
  const teamKey = `${team.region}:${team.teamId}`
  if (expectedTeam && expectedTeam !== teamKey)
    throw new Error("Your active team changed. Reload to continue.")
  const { data, error } = await cellFor(team.region)
    .createAdminClient()
    .from("billing_signup_choice")
    .select("state, offer_key")
    .eq("team_id", team.teamId)
    .maybeSingle()
  // A cell without the onboarding migration still runs the existing signup flow.
  // Once the table exists, every error is blocking rather than proof of completion.
  if (error && error.code !== "42P01" && error.code !== "PGRST205")
    throw new Error("Unable to check your plan. Please retry.")
  const requestedOffer = readPlanOffer(
    (await cookies()).get(PLAN_OFFER_COOKIE)?.value,
    userId,
  )
  return {
    userId,
    teamKey,
    ...parseSignupChoice(error ? null : data),
    requestedOffer,
  }
}
