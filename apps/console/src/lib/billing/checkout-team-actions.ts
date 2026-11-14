"use server"

import { membershipExistsInCell } from "@/lib/api/team-directory"
import { listTeamsAction } from "@/lib/api/teams-actions"
import type { CheckoutLocator } from "@/lib/billing/signup-checkout-paths"
import { configuredRegions } from "@/lib/cells"
import { createServerClient } from "@/lib/supabase/server"

export type CheckoutTeam =
  | { kind: "signed_out" }
  | { kind: "other_account" }
  | { kind: "open" }
  | { kind: "switch"; team: { id: string; name: string; region: string } }
  | { kind: "not_member" }

export async function getCheckoutTeamAction(
  locator: CheckoutLocator,
): Promise<CheckoutTeam> {
  const {
    data: { user },
  } = await (await createServerClient()).auth.getUser()
  if (!user) return { kind: "signed_out" }
  if (locator.account !== user.id) return { kind: "other_account" }

  const { teams, activeTeamId, activeRegion } = await listTeamsAction()
  const team = teams.find(
    (team) => `${team.region}:${team.id}` === locator.team,
  )
  if (!team) {
    const separator = locator.team.indexOf(":")
    const region = locator.team.slice(0, separator)
    const teamId = locator.team.slice(separator + 1)
    if (
      separator < 0 ||
      !configuredRegions().includes(region) ||
      !teamId ||
      !(await membershipExistsInCell(region, user.id, teamId))
    )
      return { kind: "not_member" }
    throw new Error("Checkout team is not available yet. Try again.")
  }
  if (team.id === activeTeamId && team.region === activeRegion)
    return { kind: "open" }
  return {
    kind: "switch",
    team: { id: team.id, name: team.name, region: team.region },
  }
}
