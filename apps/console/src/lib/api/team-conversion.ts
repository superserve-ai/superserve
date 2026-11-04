import { cellFor } from "@/lib/cells"

const TEAM_OWNER_ROLE = "team_owner"

// First login provisions the account's own team and names it after the
// user's email (see proxy-auth). Creating a team from that account renames
// this team in place, so its sandboxes, keys, plan, and billing carry over.
export function isPersonalTeam(
  team: { name: string },
  email: string | undefined,
): boolean {
  return !!email && team.name.toLowerCase() === email.toLowerCase()
}

// Mirrors the control plane's owner check: a legacy owner row, or an
// unrevoked team_owner assignment.
export async function ownsTeam(
  region: string,
  userId: string,
  teamId: string,
): Promise<boolean> {
  const admin = cellFor(region).createAdminClient()
  const { data: legacy, error: legacyError } = await admin
    .from("team_member")
    .select("role")
    .eq("profile_id", userId)
    .eq("team_id", teamId)
    .in("role", ["owner", TEAM_OWNER_ROLE])
    .limit(1)
  if (legacyError) throw new Error(legacyError.message)
  if (legacy?.length) return true

  const { data: role, error: roleError } = await admin
    .from("roles")
    .select("id")
    .eq("name", TEAM_OWNER_ROLE)
    .single()
  if (roleError || !role)
    throw new Error(
      `Failed to look up ${TEAM_OWNER_ROLE} role: ${roleError?.message ?? "not found"}`,
    )
  const { data: assignments, error: assignmentError } = await admin
    .from("user_role_assignments")
    .select("id")
    .eq("user_id", userId)
    .eq("team_id", teamId)
    .eq("role_id", role.id)
    .eq("scope_type", "team")
    .is("revoked_at", null)
    .limit(1)
  if (assignmentError) throw new Error(assignmentError.message)
  return !!assignments?.length
}

/**
 * Renames the team only while it still has its expected name, so two
 * concurrent conversions cannot both apply.
 */
export async function renameTeam(
  region: string,
  teamId: string,
  from: string,
  to: string,
): Promise<"renamed" | "name_taken" | "changed"> {
  const admin = cellFor(region).createAdminClient()
  const { data, error } = await admin
    .from("team")
    .update({ name: to, updated_at: new Date().toISOString() })
    .eq("id", teamId)
    .eq("name", from)
    .select("id")
  if (error?.code === "23505") return "name_taken"
  if (error) throw new Error(`Failed to rename team: ${error.message}`)
  return data?.length ? "renamed" : "changed"
}
