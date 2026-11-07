import "server-only"
import type { User } from "@supabase/supabase-js"

import { writeTeamSelection } from "@/lib/api/active-team"
import {
  invalidateMembershipDirectory,
  listTeamMembershipsForUserDetailed,
} from "@/lib/api/team-directory"
import {
  clearFirstSignup,
  completedMemberships,
  completeFirstSignup,
} from "@/lib/api/team-provisioning"
import {
  GoogleSignupRecoveryRequiredError,
  isGoogleUser,
} from "@/lib/auth/google-signup-proof"
import { inviteTokenRegion } from "@/lib/auth/invite-return-path"
import { SignupRestrictedError } from "@/lib/auth/signup-restrictions"
import {
  assertSignupReviewCleared,
  SignupReviewPendingError,
} from "@/lib/auth/signup-review"
import { createServerClient } from "@/lib/supabase/server"

import {
  decideInviteView,
  type InviteFailure,
  type InviteTeamState,
  type InviteView,
} from "./decision"
import { hasInviteIntent } from "./intent"
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
// after its email be created. The read is fresh and cross-region: a cached
// (or substituted) directory could still say "no team" after the account joined one, and a
// degraded read must never count as "no team".
async function readTeamState(userId: string): Promise<InviteTeamState> {
  try {
    const directory = await listTeamMembershipsForUserDetailed(userId, {
      strict: true,
    })
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
    intent: user ? await hasInviteIntent(token) : false,
    failure,
  })
  return {
    view,
    user: user?.email ? { id: user.id, email: user.email } : null,
  }
}

export type InviteAcceptOutcome =
  | InviteAcceptResult
  | { ok: false; error: "not_eligible" }

function isFirstSignupRefusal(error: unknown): boolean {
  return (
    error instanceof SignupRestrictedError ||
    error instanceof SignupReviewPendingError ||
    error instanceof GoogleSignupRecoveryRequiredError
  )
}

/**
 * Accepts the invitation for the signed-in account, then points the console at
 * the joined team. Callers must be a route handler or server action: setting
 * the active-team cookie is not allowed while rendering.
 *
 * Joining a team is a first team for an account that has none, so the same
 * first-signup gates as provisioning apply here (Google proof, device
 * restriction, Enterprise review hold) before the backend is called, and the
 * proof is spent after it succeeds. Accounts that already belong to a team
 * pass untouched. Nothing here provisions a team.
 */
export async function acceptInviteAndSelectTeam(
  token: string,
  user: User,
): Promise<InviteAcceptOutcome> {
  const region = inviteTokenRegion(token)
  if (!region || !user.email) return { ok: false, error: "unavailable" }

  let clearance: Awaited<ReturnType<typeof clearFirstSignup>>
  try {
    assertSignupReviewCleared(user)
    clearance = await clearFirstSignup(region, user, {
      googleProof: isGoogleUser(user),
    })
  } catch (error) {
    if (isFirstSignupRefusal(error)) return { ok: false, error: "not_eligible" }
    throw error
  }

  const result = await acceptInvitation(token, {
    id: user.id,
    email: user.email,
  })
  if (!result.ok) return result
  invalidateMembershipDirectory(user.id)
  await writeTeamSelection({ region: result.region, teamId: result.teamId })
  try {
    await completeFirstSignup(user.id, clearance)
  } catch (error) {
    // The account is already on the team; a proof that could not be spent
    // does not undo that.
    console.warn("Invite acceptance could not clear first-signup state", {
      userId: user.id,
      error: error instanceof Error ? error.message : String(error),
    })
  }
  return result
}
