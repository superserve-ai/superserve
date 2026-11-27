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

// The control plane authorizes by RBAC: once the user has an RBAC membership
// for the team, only an unrevoked team_owner assignment counts, because a
// revoked grant leaves the legacy owner row in place. The legacy row decides
// only for a membership that was never migrated to RBAC.
export async function ownsTeam(
  region: string,
  userId: string,
  teamId: string,
): Promise<boolean> {
  const admin = cellFor(region).createAdminClient()
  const { data: membership, error: membershipError } = await admin
    .from("team_memberships")
    .select("id")
    .eq("user_id", userId)
    .eq("team_id", teamId)
    .limit(1)
  if (membershipError) throw new Error(membershipError.message)

  if (!membership?.length) {
    const { data: legacy, error: legacyError } = await admin
      .from("team_member")
      .select("role")
      .eq("profile_id", userId)
      .eq("team_id", teamId)
      .in("role", ["owner", TEAM_OWNER_ROLE])
      .limit(1)
    if (legacyError) throw new Error(legacyError.message)
    return !!legacy?.length
  }

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
 * Checks ownership and renames the team in one database step, so a revoked
 * owner role cannot rename. A concurrent conversion to the same name counts
 * as renamed.
 */
export async function renameOwnedTeam(
  region: string,
  userId: string,
  teamId: string,
  from: string,
  to: string,
): Promise<"renamed" | "name_taken" | "changed" | "not_owner"> {
  const { data, error } = await cellFor(region)
    .createAdminClient()
    .rpc("rename_owned_team", {
      p_user: userId,
      p_team: teamId,
      p_from: from,
      p_to: to,
    })
  if (error) throw new Error(`Failed to rename team: ${error.message}`)
  if (
    data !== "renamed" &&
    data !== "name_taken" &&
    data !== "changed" &&
    data !== "not_owner"
  )
    throw new Error(`Failed to rename team: unexpected outcome ${data}`)
  return data
}
