import { notFound } from "next/navigation"

import { isStaff } from "@/lib/admin/staff"
import {
  listAllTeamsAction,
  startImpersonationAction,
} from "@/lib/admin/teams-actions"
import { createServerClient } from "@/lib/supabase/server"

import { AdminTeamsTable } from "./admin-teams-table"

export default async function AdminPage() {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!isStaff(user)) notFound()

  const teams = await listAllTeamsAction()
  return <AdminTeamsTable teams={teams} onActAs={startImpersonationAction} />
}
