import "server-only"
import type { User } from "@supabase/supabase-js"

import {
  orderTeamsOldestFirst,
  readTeamSelection,
  savedTeamSelection,
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

// Runs once at sign-in, before the dashboard opens. When this browser has no
// valid team cookie, it writes one: the team the user last switched to, else
// the oldest team that can open the dashboard, else the oldest team. Every
// server path then reads the same cookie, so they agree on the team.
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
    if (current) return current
    if (
      directory.degradedRegions.length ||
      degradedRegions.length ||
      !memberships.length
    )
      return null

    let chosen = match(savedTeamSelection(user))
    if (!chosen && memberships.length === 1) chosen = memberships[0]
    if (!chosen) {
      const ordered = orderTeamsOldestFirst(
        memberships,
        await readTeamCreationDates(memberships),
      )
      for (let start = 0; start < ordered.length; start += 5) {
        const batch = ordered.slice(start, start + 5)
        const able = await Promise.all(
          batch.map(async (team) => {
            try {
              const context = await readSignupPlan(user.id, team)
              return (
                !needsPlanSelection(context) &&
                awaitingPlanRedirect(context) === null
              )
            } catch {
              // Skip teams whose plans cannot be read.
              return false
            }
          }),
        )
        chosen = batch.find((_, index) => able[index])
        if (chosen) break
      }
      chosen ??= ordered[0]
    }
    await writeTeamSelection(chosen)
    return chosen
  } catch {
    return null
  }
}
