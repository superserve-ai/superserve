import { UsersIcon } from "@phosphor-icons/react/dist/ssr"
import { notFound } from "next/navigation"

import { EmptyState } from "@/components/empty-state"
import { AdminBillingRequestError } from "@/lib/admin/billing-api"
import { canWriteAdminBilling } from "@/lib/admin/permissions"
import {
  getTeamPlanBilling,
  isUuid,
  listStaffCredits,
  type TeamPlanBilling,
} from "@/lib/admin/team-billing"
import { configuredRegions } from "@/lib/cells"
import { createServerClient } from "@/lib/supabase/server"

import { TeamBillingView } from "./team-billing-view"

export default async function AdminBillingTeamPage({
  params,
  searchParams,
}: {
  params: Promise<{ team_id: string }>
  searchParams: Promise<{ region?: string }>
}) {
  const { team_id: teamId } = await params
  const { region = "" } = await searchParams
  if (!isUuid(teamId) || !configuredRegions().includes(region)) notFound()

  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const canWrite = canWriteAdminBilling(user)

  const credits = listStaffCredits(region, teamId).catch(() => null)
  let view: TeamPlanBilling
  try {
    view = await getTeamPlanBilling(region, teamId)
  } catch (error) {
    if (error instanceof AdminBillingRequestError) {
      if (error.kind === "not_found") notFound()
      return (
        <EmptyState
          icon={UsersIcon}
          title={
            error.kind === "forbidden"
              ? "Billing access required"
              : "Team billing is unavailable"
          }
          description={
            error.kind === "forbidden"
              ? "Your staff session cannot read platform billing. Sign in again with your staff Google account."
              : "Billing details could not be loaded. Try again shortly."
          }
        />
      )
    }
    throw error
  }

  return (
    <TeamBillingView
      view={view}
      staffCredits={await credits}
      region={region}
      teamId={teamId}
      canWrite={canWrite}
    />
  )
}
