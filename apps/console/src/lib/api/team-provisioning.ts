import type { User } from "@supabase/supabase-js"

import {
  recoverPromotionTeam,
  preparePromotionTeam,
  completePromotionTeam,
} from "@/lib/api/promotion-device-evidence"
import { publishAccountPromotion } from "@/lib/api/promotion-publication"
import {
  listTeamMembershipsForUserDetailed,
  type MembershipDirectory,
  type TeamMembership,
} from "@/lib/api/team-directory"
import { classifyGoogleMembershipState } from "@/lib/auth/google-onboarding"
import {
  consumeGoogleSignupProof,
  isGoogleUser,
  requireGoogleSignupProof,
} from "@/lib/auth/google-signup-proof"
import {
  clearEvaluatedSignupEvidence,
  readSignupEvidenceEntries,
  type SignupEvidenceEntry,
} from "@/lib/auth/signup-evidence"
import { evaluateSignupRestriction } from "@/lib/auth/signup-restrictions"
import { cellFor, DEFAULT_REGION } from "@/lib/cells"
import { createServerClient } from "@/lib/supabase/server"

const TEAM_OWNER_ROLE = "team_owner"
// The production console deployment of a82fad13 (GitHub deployment 5383860469)
// succeeded at this time. Earlier owner rows can be completed legacy accounts.
const RBAC_PROVISIONING_START = Date.parse("2026-07-09T22:45:42Z")

export async function completedMemberships(
  userId: string,
  directory: MembershipDirectory,
): Promise<MembershipDirectory> {
  const degradedRegions = new Set(directory.degradedRegions)
  const checked = await Promise.allSettled(
    directory.memberships.map(async (membership) => {
      if (degradedRegions.has(membership.region)) return false
      const admin = cellFor(membership.region).createAdminClient()
      const { data: assignments, error: assignmentError } = await admin
        .from("user_role_assignments")
        .select("id")
        .eq("user_id", userId)
        .eq("team_id", membership.teamId)
        .eq("scope_type", "team")
        .limit(1)
      if (assignmentError) throw new Error(assignmentError.message)
      if (assignments?.length) {
        return true
      }

      const { data: rbac, error: rbacError } = await admin
        .from("team_memberships")
        .select("id")
        .eq("user_id", userId)
        .eq("team_id", membership.teamId)
        .limit(1)
      if (rbacError) throw new Error(rbacError.message)
      const { data: legacy, error: legacyError } = await admin
        .from("team_member")
        .select("joined_at, role")
        .eq("profile_id", userId)
        .eq("team_id", membership.teamId)
        .limit(1)
      if (legacyError) throw new Error(legacyError.message)
      const ownerRow = legacy?.[0]
      // This console's unfinished standalone creation writes an owner row
      // before its RBAC role assignment. An active joined member can have no
      // assignment at all, so the role assignment alone is not completion.
      const unfinishedOwner =
        ownerRow?.role === "owner" &&
        !(
          ownerRow.joined_at &&
          Date.parse(ownerRow.joined_at) < RBAC_PROVISIONING_START
        )
      if (unfinishedOwner) return false
      if (legacy?.length) {
        return true
      }
      if (rbac?.length) {
        // A joined member may have no assignment or legacy row. A failed
        // standalone creation can leave this RBAC row after cleanup, so
        // require an established owner assignment for the team.
        const { data: ownerRoles, error: ownerRoleError } = await admin
          .from("roles")
          .select("id")
          .eq("name", TEAM_OWNER_ROLE)
          .limit(1)
        if (ownerRoleError) throw new Error(ownerRoleError.message)
        if (ownerRoles?.length) {
          const { data: owners, error: ownerError } = await admin
            .from("user_role_assignments")
            .select("id")
            .eq("team_id", membership.teamId)
            .eq("role_id", ownerRoles[0].id)
            .eq("scope_type", "team")
            .is("revoked_at", null)
            .limit(1)
          if (ownerError) throw new Error(ownerError.message)
          if (owners?.length) {
            return true
          }
        }
        const { data: legacyOwners, error: legacyOwnerError } = await admin
          .from("team_member")
          .select("profile_id")
          .eq("team_id", membership.teamId)
          .eq("role", "owner")
          .limit(1)
        if (legacyOwnerError) throw new Error(legacyOwnerError.message)
        if (legacyOwners?.length) return true
      }
      return false
    }),
  )
  const memberships: TeamMembership[] = []
  checked.forEach((result, index) => {
    const membership = directory.memberships[index]
    if (result.status === "rejected") {
      const error = result.reason
      if (membership.region === DEFAULT_REGION) throw error
      if (!degradedRegions.has(membership.region)) {
        degradedRegions.add(membership.region)
        console.error(
          `team completion: cell ${membership.region} lookup failed, serving without it:`,
          error,
        )
      }
    } else if (result.value) {
      memberships.push(membership)
    }
  })
  return {
    memberships: memberships.filter((m) => !degradedRegions.has(m.region)),
    degradedRegions: [...degradedRegions],
  }
}

export interface ProvisionedTeam {
  id: string
  name: string
  region: string
}

async function guardFirstGoogleTeam(
  userId: string,
  user: {
    id: string
    app_metadata?: { provider?: string; providers?: string[] }
  },
): Promise<{ signupAttemptId?: string } | null> {
  if (user.id !== userId || !isGoogleUser(user)) return null

  const directory = await completedMemberships(
    userId,
    await listTeamMembershipsForUserDetailed(userId, { maxAgeMs: 0 }),
  )
  const state = await classifyGoogleMembershipState(userId, directory)
  if (state.kind === "existing") return null
  if (state.kind === "indeterminate") {
    console.warn("Google onboarding blocked: membership lookup degraded", {
      userId,
      degradedRegions: state.degradedRegions,
      stage: "provisioning",
    })
    throw new Error("Google membership lookup degraded; please try again")
  }
  return {
    signupAttemptId: await requireGoogleSignupProof(userId),
  }
}

export async function provisionTeam(
  region: string,
  userId: string,
  _email: string,
  name: string,
  observation?: { user: User; observedAt: string },
  operationId?: string,
): Promise<ProvisionedTeam> {
  // This is the common value boundary for lazy onboarding and explicit team
  // creation. A direct Supabase Google OAuth session must not be able to call
  // either path and receive its first team without the pre-auth proof.
  let user = observation?.user
  let observedAt = observation?.observedAt
  if (!observation) {
    const supabase = await createServerClient()
    const { data, error } = await supabase.auth.getUser()
    observedAt = new Date().toISOString()
    if (error) throw new Error("Unable to verify authenticated user")
    user = data.user ?? undefined
  }
  if (!user || !observedAt || user.id !== userId) {
    throw new Error("Authenticated user mismatch")
  }
  const googleUser = isGoogleUser(user)
  const googleProvisioning = googleUser
    ? await guardFirstGoogleTeam(userId, user)
    : null
  let firstTeam = googleProvisioning !== null
  if (!googleUser) {
    const directory = await completedMemberships(
      userId,
      await listTeamMembershipsForUserDetailed(userId, { maxAgeMs: 0 }),
    )
    if (
      directory.memberships.length === 0 &&
      directory.degradedRegions.length > 0
    )
      throw new Error("Membership lookup degraded; please try again")
    firstTeam = directory.memberships.length === 0
  }
  let evaluatedEvidence: SignupEvidenceEntry[] = []
  if (firstTeam) {
    // The actor-bound signed context is the authority for active evidence.
    // Google proof validation and consumption remain independent.
    evaluatedEvidence = await readSignupEvidenceEntries(userId)
    await evaluateSignupRestriction(
      region,
      userId,
      evaluatedEvidence[0]?.visitor ?? null,
    )
  }
  const admin = cellFor(region).createAdminClient()

  // The Auth UUID is reserved for the single automatic initial East intent.
  // Explicit creations must retain a separate locator before calling this boundary.
  if (!operationId && region !== DEFAULT_REGION)
    throw new Error("Team creation requires its original operation identifier")
  const locator = { userId, region, operationId: operationId ?? userId }
  let prepared = await recoverPromotionTeam(locator)
  if (!prepared) {
    if (!operationId && !firstTeam)
      throw new Error("No initial team creation to recover")
    const publication = await publishAccountPromotion(region, user, observedAt)
    prepared = await preparePromotionTeam({ ...locator, name, ...publication })
  }
  if (prepared.authorityUnavailable) {
    // Repair only the regional FK target. The persisted no-credit decision
    // remains unchanged even if canonical publication failed before profile creation.
    const { error } = await admin
      .from("profile")
      .upsert(
        { id: userId, email: user.email ?? "" },
        { onConflict: "id", ignoreDuplicates: true },
      )
    if (error) throw new Error("Failed to repair regional profile")
  }
  const completed = await completePromotionTeam(prepared)
  if (completed.state === "deleted")
    throw new Error("This team creation has already been deleted")
  const team = { id: completed.teamId, name: completed.name }

  try {
    const { error: memberErr } = await admin.from("team_member").insert({
      team_id: team.id,
      profile_id: userId,
      role: "owner",
    })
    if (memberErr?.code === "23505") {
      const { data: existing, error } = await admin
        .from("team_member")
        .select("team_id")
        .eq("team_id", team.id)
        .eq("profile_id", userId)
        .eq("role", "owner")
        .limit(1)
      if (error || !existing?.length)
        throw new Error("Unable to verify existing team owner")
    } else if (memberErr) {
      throw new Error(`Failed to add team member: ${memberErr.message}`)
    }

    const { error: membershipErr } = await admin
      .from("team_memberships")
      .insert({
        id: team.id,
        team_id: team.id,
        user_id: userId,
        status: "active",
      })
    if (membershipErr?.code === "23505") {
      const { data: existing, error } = await admin
        .from("team_memberships")
        .select("id")
        .eq("team_id", team.id)
        .eq("user_id", userId)
        .eq("status", "active")
        .limit(1)
      if (error || !existing?.length)
        throw new Error("Unable to verify existing active membership")
    } else if (membershipErr) {
      throw new Error(
        `Failed to create team membership: ${membershipErr.message}`,
      )
    }

    const { data: role, error: roleErr } = await admin
      .from("roles")
      .select("id")
      .eq("name", TEAM_OWNER_ROLE)
      .single()
    if (roleErr || !role) {
      throw new Error(
        `Failed to look up ${TEAM_OWNER_ROLE} role: ${roleErr?.message ?? "not found"}`,
      )
    }

    const { error: assignErr } = await admin
      .from("user_role_assignments")
      .insert({
        id: team.id,
        user_id: userId,
        role_id: role.id,
        scope_type: "team",
        team_id: team.id,
      })
    if (assignErr?.code === "23505") {
      const { data: existing, error } = await admin
        .from("user_role_assignments")
        .select("id")
        .eq("user_id", userId)
        .eq("role_id", role.id)
        .eq("team_id", team.id)
        .eq("scope_type", "team")
        .is("revoked_at", null)
        .limit(1)
      if (error || !existing?.length)
        throw new Error("Unable to verify existing team owner assignment")
    } else if (assignErr) {
      throw new Error(
        `Failed to assign ${TEAM_OWNER_ROLE}: ${assignErr.message}`,
      )
    }
  } catch (chainErr) {
    // The backend committed this team and its decision. Retain partial membership
    // writes so the same operation can safely finish after an uncertain response.
    throw new Error(
      `${chainErr instanceof Error ? chainErr.message : String(chainErr)} (team ${team.id})`,
      { cause: chainErr },
    )
  }

  if (googleProvisioning) {
    if (googleProvisioning.signupAttemptId)
      await consumeGoogleSignupProof(userId, googleProvisioning.signupAttemptId)
    else await consumeGoogleSignupProof(userId)
  }
  if (firstTeam) await clearEvaluatedSignupEvidence(userId, evaluatedEvidence)
  return { id: team.id as string, name: team.name as string, region }
}
