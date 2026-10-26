import "server-only"
import { cookies } from "next/headers"

import {
  parseSignupChoice,
  type SignupPlanContext,
} from "@/lib/api/signup-plan"
import { SignupSetupBlockedError } from "@/lib/api/signup-setup-error"
import type { TeamMembership } from "@/lib/api/team-directory"
import { PLAN_OFFER_COOKIE, readPlanOffer } from "@/lib/auth/plan-preselection"
import { cellFor } from "@/lib/cells"

async function hasPlanAssignment(
  admin: ReturnType<ReturnType<typeof cellFor>["createAdminClient"]>,
  teamId: string,
): Promise<boolean> {
  const now = new Date().toISOString()
  const { data, error } = await admin
    .from("team_plan_assignment")
    .select("id")
    .eq("team_id", teamId)
    .lte("effective_from", now)
    .or(`effective_to.is.null,effective_to.gt.${now}`)
    .limit(1)
  // Cells without pricing v2 have no assignments table; nothing is assigned.
  if (error && error.code !== "42P01" && error.code !== "PGRST205")
    throw new Error("Unable to check your plan. Please retry.")
  return !error && (data?.length ?? 0) > 0
}

// The caller must authenticate the user and resolve their team membership.
export async function readSignupPlan(
  userId: string,
  team: TeamMembership,
  expectedTeam?: string,
): Promise<SignupPlanContext> {
  const teamKey = `${team.region}:${team.teamId}`
  if (expectedTeam && expectedTeam !== teamKey)
    throw new SignupSetupBlockedError("team_changed")
  const admin = cellFor(team.region).createAdminClient()
  const { data, error } = await admin
    .from("billing_signup_choice")
    .select("state, offer_key")
    .eq("team_id", team.teamId)
    .maybeSingle()
  // A cell without the onboarding migration still runs the existing signup flow.
  // Once the table exists, every error is blocking rather than proof of completion.
  if (error && error.code !== "42P01" && error.code !== "PGRST205")
    throw new Error("Unable to check your plan. Please retry.")
  const choice = parseSignupChoice(error ? null : data)
  if (
    (choice.state === "selecting" || choice.state === "pending") &&
    (await hasPlanAssignment(admin, team.teamId))
  ) {
    // Pricing v2 assigns every plan directly; the signup picker doesn't apply.
    choice.state = "legacy"
    choice.offer = null
  }
  if (choice.state === "selecting" || choice.state === "pending") {
    const [intent, billing] = await Promise.all([
      admin
        .from("yc_claim_team_intent")
        .select("claim_id, released_at")
        .eq("team_id", team.teamId)
        .maybeSingle(),
      admin
        .from("billing_yc_operation")
        .select("id")
        .eq("team_id", team.teamId)
        .maybeSingle(),
    ])
    for (const result of [intent, billing]) {
      if (
        result.error &&
        result.error.code !== "42P01" &&
        result.error.code !== "PGRST205"
      )
        throw new Error("Unable to check your plan. Please retry.")
    }
    // The durable backend fence owns plan routing, including uncertain binds.
    // This permits dashboard/payment setup; billing still owns all entitlements.
    // Revoking eligibility can release the claim fence while an existing billing
    // contract still requires dashboard access and payment management.
    if (
      (!intent.error &&
        intent.data?.claim_id &&
        intent.data.released_at === null) ||
      (!billing.error && billing.data?.id)
    ) {
      choice.state = "yc_claim"
      choice.offer = null
    }
  }
  if (choice.state === "selecting" || choice.state === "pending") {
    const upgrade = await admin
      .from("billing_pro_upgrade")
      .select("state, offer_key")
      .eq("team_id", team.teamId)
      .not("state", "in", "(expired,ended)")
      .maybeSingle()
    if (
      upgrade.error &&
      upgrade.error.code !== "42P01" &&
      upgrade.error.code !== "PGRST205"
    )
      throw new Error("Unable to check your payment. Please retry.")
    if (upgrade.data) {
      const paid = parseSignupChoice({
        state: upgrade.data.state === "active" ? "committed" : "pending",
        offer_key: upgrade.data.offer_key,
      })
      choice.state = paid.state
      choice.offer = paid.offer
    }
  }
  const requestedOffer = readPlanOffer(
    (await cookies()).get(PLAN_OFFER_COOKIE)?.value,
    userId,
  )
  return {
    userId,
    teamKey,
    ...choice,
    requestedOffer,
  }
}
