import type { User } from "@supabase/supabase-js"
import { after } from "next/server"

import {
  authorizeEnterpriseProvisioning,
  enterpriseProvisioningContext,
  type EnterpriseProvisioningAuthority,
} from "@/lib/admin/enterprise-provisioning-authority"
import {
  recoverPromotionTeamForEnterprise,
  preparePromotionTeamForEnterprise,
  completePromotionTeamForEnterprise,
  recoverPromotionTeam,
  preparePromotionTeam,
  completePromotionTeam,
} from "@/lib/api/promotion-device-evidence"
import {
  publishAccountPromotion,
  publishEnterpriseAccountPromotion,
  type TrialWithheldReason,
} from "@/lib/api/promotion-publication"
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
import {
  assertSignupReviewCleared,
  signupReviewStatus,
} from "@/lib/auth/signup-review"
import { cellFor, configuredRegions, DEFAULT_REGION } from "@/lib/cells"
import { trackEvent } from "@/lib/posthog/actions"
import { AUTH_EVENTS } from "@/lib/posthog/events"
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

// Each cell claims a user's one Free team itself; a claim held in another cell
// makes this team additional. Unreadable cells fail the creation for a retry.
async function holdsFreeTeamElsewhere(
  userId: string,
  region: string,
): Promise<boolean> {
  const claims = await Promise.all(
    configuredRegions()
      .filter((other) => other !== region)
      .map(async (other) => {
        const admin = cellFor(other).createAdminClient()
        const { data, error } = await admin
          .from("billing_account_free_team")
          .select("team_id")
          .eq("user_id", userId)
          .limit(1)
        if (!error) return (data?.length ?? 0) > 0
        if (error.code !== "42P01" && error.code !== "PGRST205")
          throw new Error("Unable to check your plan. Please retry.")
        // A cell from before Free claims records none, but a team the user
        // owns there may be their Free one, so a new team is additional.
        const owned = await admin
          .from("team_member")
          .select("team_id")
          .eq("profile_id", userId)
          .eq("role", "owner")
          .limit(1)
        if (owned.error)
          throw new Error("Unable to check your plan. Please retry.")
        return (owned.data?.length ?? 0) > 0
      }),
  )
  return claims.some(Boolean)
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

export interface FirstSignupClearance {
  firstTeam: boolean
  googleProvisioning: { signupAttemptId?: string } | null
  evidence: SignupEvidenceEntry[]
}

/**
 * The first-signup gates, without creating anything: Google first-team proof,
 * the device restriction and a degraded membership lookup. Accounts that
 * already hold a completed team are not a first signup and pass untouched.
 * Pair a successful outcome with completeFirstSignup.
 */
export async function clearFirstSignup(
  region: string,
  user: User,
  { googleProof }: { googleProof: boolean },
): Promise<FirstSignupClearance> {
  const userId = user.id
  const googleProvisioning = googleProof
    ? await guardFirstGoogleTeam(userId, user)
    : null
  let firstTeam = googleProvisioning !== null
  if (!googleProof) {
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
  let evidence: SignupEvidenceEntry[] = []
  if (firstTeam) {
    // The actor-bound signed context is the authority for active evidence.
    // Google proof validation and consumption remain independent.
    evidence = await readSignupEvidenceEntries(userId)
    await evaluateSignupRestriction(
      region,
      userId,
      evidence[0]?.visitor ?? null,
    )
  }
  return { firstTeam, googleProvisioning, evidence }
}

/** Spends the first-signup proof and evidence once the account has its team. */
export async function completeFirstSignup(
  userId: string,
  { firstTeam, googleProvisioning, evidence }: FirstSignupClearance,
): Promise<void> {
  if (googleProvisioning) {
    if (googleProvisioning.signupAttemptId)
      await consumeGoogleSignupProof(userId, googleProvisioning.signupAttemptId)
    else await consumeGoogleSignupProof(userId)
  }
  if (firstTeam) await clearEvaluatedSignupEvidence(userId, evidence)
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
  assertSignupReviewCleared(user)
  return provisionTeamFor(region, user, name, observedAt, operationId, {
    googleProof: isGoogleUser(user),
  })
}

/**
 * Creates the first team of an Enterprise applicant staff are granting access.
 * The account is still held, and its Google signup proof was checked when the
 * hold was placed, so neither is checked here. Retries recover the same team.
 */
export async function provisionHeldApplicantTeam(
  user: User,
  region: string,
  planVersionId: string,
): Promise<ProvisionedTeam> {
  if (signupReviewStatus(user) !== "pending")
    throw new Error("Only held applicants are provisioned by staff")
  const authority = await authorizeEnterpriseProvisioning(
    user.id,
    region,
    planVersionId,
  )
  const { user: applicant } = enterpriseProvisioningContext(
    authority,
    user.id,
    region,
    user.id,
  )
  return provisionTeamFor(
    region,
    applicant,
    applicant.email ?? applicant.id,
    new Date().toISOString(),
    user.id,
    { googleProof: false, enterpriseAuthority: authority },
  )
}

/** Telemetry runs after the response and never delays or fails provisioning. */
function recordTrialWithheld(
  userId: string,
  properties: Record<string, string>,
) {
  try {
    after(async () => {
      try {
        await trackEvent(AUTH_EVENTS.SIGNUP_TRIAL_WITHHELD, userId, properties)
      } catch {
        // Telemetry cannot alter provisioning.
      }
    })
  } catch {
    // Telemetry cannot alter provisioning.
  }
}

async function provisionTeamFor(
  region: string,
  user: User,
  name: string,
  observedAt: string,
  operationId: string | undefined,
  {
    googleProof,
    enterpriseAuthority,
  }: {
    googleProof: boolean
    enterpriseAuthority?: EnterpriseProvisioningAuthority
  },
): Promise<ProvisionedTeam> {
  const userId = user.id
  const clearance = await clearFirstSignup(region, user, { googleProof })
  const { firstTeam } = clearance
  const admin = cellFor(region).createAdminClient()

  // The Auth UUID is reserved for the single automatic initial East intent.
  // Explicit creations must retain a separate locator before calling this boundary.
  if (!operationId && region !== DEFAULT_REGION)
    throw new Error("Team creation requires its original operation identifier")
  const locator = { userId, region, operationId: operationId ?? userId }
  let trialWithheld: TrialWithheldReason | undefined
  let prepared = enterpriseAuthority
    ? await recoverPromotionTeamForEnterprise(locator, enterpriseAuthority)
    : await recoverPromotionTeam(locator)
  if (!prepared) {
    if (!operationId && !firstTeam)
      throw new Error("No initial team creation to recover")
    const publication = enterpriseAuthority
      ? await publishEnterpriseAccountPromotion(
          region,
          user,
          observedAt,
          enterpriseAuthority,
        )
      : await publishAccountPromotion(region, user, observedAt)
    trialWithheld = publication.trialWithheld
    const preparation = {
      ...locator,
      name,
      // An unverified sign-up device stores the same no-credit decision as a
      // failed publication: the team is created, and the trial is withheld.
      authorityUnavailable:
        publication.authorityUnavailable || trialWithheld !== undefined,
      additionalTeam:
        !enterpriseAuthority && (await holdsFreeTeamElsewhere(userId, region)),
    }
    prepared = enterpriseAuthority
      ? await preparePromotionTeamForEnterprise(
          preparation,
          enterpriseAuthority,
        )
      : await preparePromotionTeam(preparation)
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
  const completed = enterpriseAuthority
    ? await completePromotionTeamForEnterprise(prepared, enterpriseAuthority)
    : await completePromotionTeam(prepared)
  if (completed.state === "deleted")
    throw new Error("This team creation has already been deleted")
  // Count only a first team whose trial this request withheld and the backend
  // then refused for that reason. A team that could not take the trial anyway
  // (an additional team, or pricing without a trial) is not counted.
  if (
    trialWithheld &&
    firstTeam &&
    completed.reason === "authority_unavailable"
  )
    recordTrialWithheld(userId, {
      reason: trialWithheld,
      region,
      team_id: completed.teamId,
      signup_method: isGoogleUser(user) ? "google" : "email",
    })
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

  await completeFirstSignup(userId, clearance)
  return { id: team.id as string, name: team.name as string, region }
}
