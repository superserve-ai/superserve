import "server-only"
import { writeTeamSelection } from "@/lib/api/active-team"
import {
  invalidateMembershipDirectory,
  listTeamMembershipsForUserDetailed,
} from "@/lib/api/team-directory"
import { completedMemberships } from "@/lib/api/team-provisioning"
import { createServerClient } from "@/lib/supabase/server"

import {
  decideInviteView,
  type InviteFailure,
  type InviteTeamState,
  type InviteView,
} from "./decision"
import {
  acceptInvitation,
  type InviteAcceptResult,
  previewInvitation,
} from "./internal-api"

export interface InviteUser {
  id: string
  email: string
}

// Read-only on purpose. The invite path must never run the first-login
// personal team provisioning (proxy-auth / api-key-mint): an invited new
// account joins the inviting team first, and only then could anything named
// after its email be created.
async function readTeamState(userId: string): Promise<InviteTeamState> {
  try {
    const directory = await listTeamMembershipsForUserDetailed(userId)
    const completed = await completedMemberships(userId, directory)
    if (completed.memberships.length > 0) return "has_teams"
    return directory.degradedRegions.length > 0 ||
      completed.degradedRegions.length > 0
      ? "unknown"
      : "none"
  } catch {
    return "unknown"
  }
}

export async function loadInviteView(
  token: string,
  failure: InviteFailure | null = null,
): Promise<{ view: InviteView; user: InviteUser | null }> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const previewResult = await previewInvitation(token)
  const viewer =
    user && user.email
      ? { email: user.email, emailVerified: Boolean(user.email_confirmed_at) }
      : null
  const view = decideInviteView({
    preview: previewResult.ok ? previewResult.preview : null,
    viewer,
    teamState: user ? await readTeamState(user.id) : "unknown",
    failure,
  })
  return {
    view,
    user: user?.email ? { id: user.id, email: user.email } : null,
  }
}

/**
 * Accepts the invitation for the signed-in account, then points the console at
 * the joined team. Callers must be a route handler or server action: setting
 * the active-team cookie is not allowed while rendering.
 */
export async function acceptInviteAndSelectTeam(
  token: string,
  user: InviteUser,
): Promise<InviteAcceptResult> {
  const result = await acceptInvitation(token, user)
  if (!result.ok) return result
  invalidateMembershipDirectory(user.id)
  await writeTeamSelection({ region: result.region, teamId: result.teamId })
  return result
}
