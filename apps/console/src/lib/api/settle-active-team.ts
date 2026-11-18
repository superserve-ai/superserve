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
// membership in that order. If this takes longer than SETTLE_TEAM_DEADLINE_MS,
// keep the cookie as it is and write nothing.
export async function settleTeamSelection(
  user: User,
): Promise<TeamMembership | null> {
  try {
    let current: TeamMembership | undefined
    let expired = false
    const chooseTeam = async () => {
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
            team.region === selection?.region &&
            team.teamId === selection.teamId,
        )
      current = match(await readTeamSelection())
      if (expired) return { current }
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

      if (
        current &&
        (memberships.length === 1 || (await isGated(current)) !== true)
      )
        return { current }
      if (directory.degradedRegions.length || degradedRegions.length)
        return { current }
      if (!memberships.length) return { current }

      if (expired) return { current }
      const saved =
        memberships.length > 1 ? match(savedTeamSelection(user)) : undefined
      let chosen = memberships.length === 1 ? memberships[0] : undefined
      if (saved && saved !== current) {
        const gated = await isGated(saved)
        if (gated === false || (!current && gated === null)) chosen = saved
      }
      if (!chosen) {
        if (expired) return { current }
        const ordered = orderTeamsOldestFirst(
          memberships,
          await readTeamCreationDates(memberships),
        )
        for (let start = 0; start < ordered.length; start += 5) {
          if (expired) return { current }
          const batch = ordered.slice(start, start + 5)
          const batchPlans = batch.map(isGated)
          for (const [index, plan] of batchPlans.entries()) {
            if ((await plan) === false) {
              chosen = batch[index]
              break
            }
          }
          if (chosen) break
        }
        if (!chosen && current) return { current }
        chosen ??= saved ?? ordered[0]
      }
      return { current, chosen }
    }

    let cancelDeadline: (() => void) | undefined
    const deadline = new Promise<{
      current: TeamMembership | undefined
      chosen?: TeamMembership
    }>((resolve) => {
      const timer = setTimeout(() => {
        expired = true
        resolve({ current })
      }, SETTLE_TEAM_DEADLINE_MS)
      cancelDeadline = () => clearTimeout(timer)
    })
    const result = await Promise.race([chooseTeam(), deadline]).finally(() =>
      cancelDeadline?.(),
    )
    if (!result.chosen) return result.current ?? null
    await writeTeamSelection(result.chosen)
    return result.chosen
  } catch {
    return null
  }
}
