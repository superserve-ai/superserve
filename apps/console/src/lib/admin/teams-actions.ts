"use server"

import { redirect } from "next/navigation"

import { logImpersonationEvent } from "@/lib/admin/audit"
import {
  clearImpersonationCookie,
  readImpersonationTeamId,
  setImpersonationCookie,
} from "@/lib/admin/impersonation"
import { revokeImpersonationKeyRow } from "@/lib/admin/impersonation-key"
import { requireImpersonationAccess, requireStaff } from "@/lib/admin/staff"
import { createAdminClient } from "@/lib/supabase/admin"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Upper bound on the admin teams list. Bounds the query instead of selecting
// the entire table; revisit with real pagination if we ever exceed this.
const MAX_TEAMS = 1000

export async function listAllTeamsAction() {
  await requireImpersonationAccess()
  const admin = createAdminClient()
  const { data, error } = await admin
    .from("team")
    .select("id, name, active_sandbox_count, max_sandboxes, created_at")
    .order("created_at", { ascending: false })
    .limit(MAX_TEAMS)
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function startImpersonationAction(teamId: string) {
  const user = await requireImpersonationAccess()
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
    try {
      await revokeImpersonationKeyRow(user.id, teamId)
    } catch (err) {
      // Best-effort: the cookie is already cleared so impersonation has stopped,
      // and the key self-expires via expires_at. Don't block the user's exit on
      // a transient DB error — just record it.
      console.error(
        "[admin-impersonation] failed to revoke key on stop",
        err instanceof Error ? err.message : err,
      )
    }
    await logImpersonationEvent({
      action: "stop",
      adminId: user.id,
      adminEmail: user.email ?? user.id,
      teamId,
    })
  }
  redirect("/admin")
}
