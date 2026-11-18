import "server-only"
import type { User } from "@supabase/supabase-js"

import {
  orderTeamsOldestFirst,
  readTeamSelection,
  savedTeamSelection,
  serializeTeamSelection,
  writeTeamSelection,
  type TeamSelection,
} from "@/lib/api/active-team"
import { needsPlanSelection } from "@/lib/api/signup-plan"
import { readSignupPlan } from "@/lib/api/signup-plan-read"
import {
  listTeamMembershipsForUserDetailed,
  readTeamCreationDates,
  type TeamMembership,
} from "@/lib/api/team-directory"
import { completedMemberships } from "@/lib/api/team-provisioning"
import { awaitingPlanRedirect } from "@/lib/billing/signup-checkout-paths"

export const SETTLE_TEAM_DEADLINE_MS = 3000

// At sign-in, keep the cookie team if it can open the dashboard or its plan
// is unknown. Otherwise try the last switched team, then the oldest team
// that can open the dashboard. Fall back to the cookie, saved team, or oldest
// membership in that order.
export async function settleTeamSelection(
  user: User,
): Promise<TeamMembership | null> {
  try {
    const directory = await listTeamMembershipsForUserDetailed(user.id, {
      maxAgeMs: 0,
    })
    const { memberships, degradedRegions } = await completedMemberships(
      user.id,
      directory,
    )
    const match = (selection: TeamSelection | null) =>
      memberships.find(
        (team) =>
          team.region === selection?.region && team.teamId === selection.teamId,
      )
    const current = match(await readTeamSelection())
    const plans = new Map<string, Promise<boolean | null>>()
    const isGated = (team: TeamMembership) => {
      const key = serializeTeamSelection(team)
      let plan = plans.get(key)
      if (!plan) {
        plan = (async () => {
          try {
            const context = await readSignupPlan(user.id, team)
            return (
              needsPlanSelection(context) ||
              awaitingPlanRedirect(context) !== null
            )
          } catch {
            return null
          }
        })()
        plans.set(key, plan)
      }
      return plan
    }

    const chooseTeam = async () => {
      if (
        current &&
        (memberships.length === 1 || (await isGated(current)) !== true)
      )
        return
      if (directory.degradedRegions.length || degradedRegions.length) return
      if (!memberships.length) return

      const saved =
        memberships.length > 1 ? match(savedTeamSelection(user)) : undefined
      let chosen = memberships.length === 1 ? memberships[0] : undefined
      if (saved && saved !== current) {
        const gated = await isGated(saved)
        if (gated === false || (!current && gated === null)) chosen = saved
      }
      if (!chosen) {
        const ordered = orderTeamsOldestFirst(
          memberships,
          await readTeamCreationDates(memberships),
        )
        for (let start = 0; start < ordered.length; start += 5) {
          const batch = ordered.slice(start, start + 5)
          const gated = await Promise.all(batch.map(isGated))
          chosen = batch.find((_, index) => gated[index] === false)
          if (chosen) break
        }
        if (!chosen && current) return
        chosen ??= saved ?? ordered[0]
      }
      return chosen
    }

    let cancelDeadline: (() => void) | undefined
    const deadline = new Promise<undefined>((resolve) => {
      const timer = setTimeout(resolve, SETTLE_TEAM_DEADLINE_MS)
      cancelDeadline = () => clearTimeout(timer)
    })
    const chosen = await Promise.race([chooseTeam(), deadline]).finally(() =>
      cancelDeadline?.(),
    )
    if (!chosen) return current ?? null
    await writeTeamSelection(chosen)
    return chosen
  } catch {
    return null
  }
}
