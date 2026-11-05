import "server-only"
import { isAuthSessionMissingError } from "@supabase/supabase-js"
import { redirect, unstable_rethrow } from "next/navigation"

import { getImpersonationContext } from "@/lib/admin/impersonation"
import { pickActiveTeam, readTeamSelection } from "@/lib/api/active-team"
import { readSignupPlan } from "@/lib/api/signup-plan-read"
import { SignupSetupBlockedError } from "@/lib/api/signup-setup-error"
import { listTeamMembershipsForUserDetailed } from "@/lib/api/team-directory"
import { completedMemberships } from "@/lib/api/team-provisioning"
import { listTeamsAction } from "@/lib/api/teams-actions"
import { createServerClient } from "@/lib/supabase/server"

export interface SignupPlanPageParams {
  team?: string
  account?: string
  billing?: string
  setup_error?: string
  setup_attempted?: string
}

export function signupPlanPath(params: SignupPlanPageParams) {
  const query = new URLSearchParams()
  if (params.team) query.set("team", params.team)
  if (params.account) query.set("account", params.account)
  if (params.billing) query.set("billing", params.billing)
  return `/onboarding/plan/?${query}`
}

// Read before sending the destination page, so navigation keeps the previous
// document visible. Provisioning stays in a handler where cookies are writable.
// A failed read is retried once before the caller shows the setup error; a
// second failure, or one that a retry can't change, still returns null.
export async function getSignupPlanPage(params: SignupPlanPageParams = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await readSignupPlanPage(params)
    } catch (error) {
      unstable_rethrow(error)
      if (attempt > 1 || error instanceof SignupSetupBlockedError) return null
    }
  }
}

async function readSignupPlanPage(params: SignupPlanPageParams) {
  const supabase = await createServerClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  // A missing session is a sign-in, not a failed account check.
  if (error && !isAuthSessionMissingError(error)) throw error
  if (!user)
    redirect(`/auth/signin?next=${encodeURIComponent(signupPlanPath(params))}`)
  if (params.account && params.account !== user.id)
    throw new SignupSetupBlockedError("account_changed")
  if (await getImpersonationContext(user))
    throw new SignupSetupBlockedError("impersonation")
  const [memberships, selection] = await Promise.all([
    listTeamMembershipsForUserDetailed(user.id, { maxAgeMs: 0 }).then(
      (directory) => completedMemberships(user.id, directory),
    ),
    readTeamSelection(),
  ])
  const team = pickActiveTeam(memberships.memberships, selection)
  if (!team) {
    if (memberships.degradedRegions.length)
      throw new Error("Membership lookup incomplete")
    if (params.setup_error || params.setup_attempted) return null
    const query = new URLSearchParams(signupPlanPath(params).split("?")[1])
    redirect(`/api/onboarding/prepare/?${query}`)
  }
  const [context, directory] = await Promise.all([
    readSignupPlan(user.id, team, params.team),
    listTeamsAction(),
  ])
  if (
    !directory.teams.some(
      (entry) => entry.id === team.teamId && entry.region === team.region,
    )
  )
    throw new Error("Team directory changed")
  return {
    context,
    directory: {
      ...directory,
      activeTeamId: team.teamId,
      activeRegion: team.region,
    },
  }
}
