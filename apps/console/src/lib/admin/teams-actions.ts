"use server"

import { redirect } from "next/navigation"

import { logImpersonationEvent } from "@/lib/admin/audit"
import {
  clearImpersonationCookie,
  readImpersonationTeamId,
  setImpersonationCookie,
} from "@/lib/admin/impersonation"
import { revokeImpersonationKeyRow } from "@/lib/admin/impersonation-key"
import { requireStaff } from "@/lib/admin/staff"
import { createAdminClient } from "@/lib/supabase/admin"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function listAllTeamsAction() {
  await requireStaff()
  const admin = createAdminClient()
  const { data, error } = await admin
    .from("team")
    .select("id, name, active_sandbox_count, max_sandboxes, created_at")
    .order("created_at", { ascending: false })
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function startImpersonationAction(teamId: string) {
  const user = await requireStaff()
  if (!UUID_RE.test(teamId)) throw new Error("Invalid team id")

  const admin = createAdminClient()
  const { data: team, error: teamError } = await admin
    .from("team")
    .select("id, name")
    .eq("id", teamId)
    .single()
  if (teamError && teamError.code !== "PGRST116") {
    throw new Error(`Failed to look up team: ${teamError.message}`)
  }
  if (!team) throw new Error("Team not found")

  await setImpersonationCookie(teamId)
  await logImpersonationEvent({
    action: "start",
    adminId: user.id,
    adminEmail: user.email ?? user.id,
    teamId,
    teamName: team.name as string,
  })
  redirect("/sandboxes")
}

export async function stopImpersonationAction() {
  const user = await requireStaff()
  const teamId = await readImpersonationTeamId()
  await clearImpersonationCookie()
  if (teamId) {
    await revokeImpersonationKeyRow(user.id, teamId)
    await logImpersonationEvent({
      action: "stop",
      adminId: user.id,
      adminEmail: user.email ?? user.id,
      teamId,
    })
  }
  redirect("/admin")
}
