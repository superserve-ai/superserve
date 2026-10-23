import { notFound } from "next/navigation"

import { canWriteAdminBilling } from "@/lib/admin/permissions"
import {
  getPlanCatalog,
  getTeamPlanAssignments,
  isUuid,
  listStaffCredits,
} from "@/lib/admin/team-billing"
import { configuredRegions } from "@/lib/cells"
import { createServerClient } from "@/lib/supabase/server"

import { TeamBillingView } from "./team-billing-view"

export default async function AdminBillingTeamPage({
  params,
  searchParams,
}: {
  params: Promise<{ team_id: string }>
  searchParams: Promise<{ region?: string | string[] }>
}) {
  const { team_id: teamId } = await params
  const { region } = await searchParams
  if (
    !isUuid(teamId) ||
    typeof region !== "string" ||
    !configuredRegions().includes(region)
  )
    notFound()

  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const [plans, catalog, staffCredits] = await Promise.all([
    getTeamPlanAssignments(region, teamId).catch(() => null),
    getPlanCatalog(region).catch(() => null),
    listStaffCredits(region, teamId).catch(() => null),
  ])

  return (
    <TeamBillingView
      plans={plans}
      catalog={catalog}
      staffCredits={staffCredits}
      region={region}
      teamId={teamId}
      canWrite={canWriteAdminBilling(user)}
    />
  )
}
