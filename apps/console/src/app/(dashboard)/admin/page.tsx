import { notFound } from "next/navigation"

import {
  canReadPlatformTeams,
  canStartPlatformImpersonation,
} from "@/lib/admin/permissions"
import { requireStaff } from "@/lib/admin/staff"
import {
  listAllTeamsAction,
  startImpersonationAction,
} from "@/lib/admin/teams-actions"

import { AdminTeamsTable } from "./admin-teams-table"

export default async function AdminPage() {
  let user
  try {
    user = await requireStaff()
  } catch {
    notFound()
  }

  if (!canReadPlatformTeams(user)) {
    notFound()
  }

  const teams = await listAllTeamsAction()
  return (
    <AdminTeamsTable
      teams={teams}
      canActAs={canStartPlatformImpersonation(user)}
      onActAs={startImpersonationAction}
    />
  )
}
