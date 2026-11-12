import "server-only"
import { isAuthSessionMissingError } from "@supabase/supabase-js"
import { redirect, unstable_rethrow } from "next/navigation"

import { getImpersonationContext } from "@/lib/admin/impersonation"
import { pickActiveTeam, readTeamSelection } from "@/lib/api/active-team"
import type { SignupPlanContext } from "@/lib/api/signup-plan"
import { readSignupPlan } from "@/lib/api/signup-plan-read"
import { SignupSetupBlockedError } from "@/lib/api/signup-setup-error"
import { listTeamMembershipsForUserDetailed } from "@/lib/api/team-directory"
import { completedMemberships } from "@/lib/api/team-provisioning"
import {
  listTeamsAction,
  type TeamDirectoryResponse,
} from "@/lib/api/teams-actions"
import { readFresh } from "@/lib/supabase/fresh-fetch"
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

export interface SignupPlanPage {
  context: SignupPlanContext
  directory: TeamDirectoryResponse
}

// "blocked" keeps the console closed: setup can't continue for this account
// or team, or the team itself couldn't be confirmed. "unavailable" is a plan
// read that failed twice for a team and directory that were confirmed, so the
// plan is unknown, not refused.
export type SignupPlanPageState =
  | { status: "ready"; page: SignupPlanPage }
  | { status: "blocked" }
  | { status: "unavailable"; directory: TeamDirectoryResponse }

// Read before sending the destination page, so navigation keeps the previous
// document visible. Provisioning stays in a handler where cookies are writable.
// A failed read is retried once, past the render's request memoization. A plan
// that still can't be read is unavailable; any other failure, or one that a
// retry can't change, is blocked.
export async function getSignupPlanPageState(
  params: SignupPlanPageParams = {},
): Promise<SignupPlanPageState> {
  for (let attempt = 1; ; attempt++) {
    try {
      const page =
        attempt > 1
          ? await readFresh(() => readSignupPlanPage(params))
          : await readSignupPlanPage(params)
      if (!page) return { status: "blocked" }
      const { context, directory } = page
      if (context) return { status: "ready", page: { context, directory } }
      if (attempt > 1) return { status: "unavailable", directory }
    } catch (error) {
      unstable_rethrow(error)
      if (attempt > 1 || error instanceof SignupSetupBlockedError)
        return { status: "blocked" }
    }
  }
}

// For callers that show the setup error whether the plan was refused or
// unknown.
export async function getSignupPlanPage(params: SignupPlanPageParams = {}) {
  const state = await getSignupPlanPageState(params)
  return state.status === "ready" ? state.page : null
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
    // Only the plan may stay unknown; the team it belongs to is still checked.
    readSignupPlan(user.id, team, params.team).catch((error: unknown) => {
      unstable_rethrow(error)
      if (error instanceof SignupSetupBlockedError) throw error
      return null
    }),
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
