import crypto from "node:crypto"

import {
  PromotionEvidenceError,
  createTeamWithPromotionAttempt,
  registerPromotionSignupDevice,
} from "@/lib/api/promotion-device-evidence"
import { listTeamMembershipsForUserDetailed } from "@/lib/api/team-directory"
import { classifyGoogleMembershipState } from "@/lib/auth/google-onboarding"
import {
  consumeGoogleSignupProof,
  isGoogleUser,
  requireGoogleSignupProof,
} from "@/lib/auth/google-signup-proof"
import { cellFor } from "@/lib/cells"
import { createServerClient } from "@/lib/supabase/server"

const TEAM_OWNER_ROLE = "team_owner"

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

  const directory = await listTeamMembershipsForUserDetailed(userId, {
    maxAgeMs: 0,
  })
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
    signupAttemptId: await requireGoogleSignupProof(),
  }
}

export async function provisionTeam(
  region: string,
  userId: string,
  email: string,
  name: string,
  creation?: {
    attemptId: string
    teamId: string
  },
): Promise<ProvisionedTeam> {
  // This is the common value boundary for lazy onboarding and explicit team
  // creation. A direct Supabase Google OAuth session must not be able to call
  // either path and receive its first team without the pre-auth proof.
  const supabase = await createServerClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user || user.id !== userId)
    throw new Error(
      `Unable to verify authenticated user: ${authError?.message ?? "account mismatch"}`,
    )
  const googleUser = !!user && user.id === userId && isGoogleUser(user)
  const googleProvisioning = googleUser
    ? await guardFirstGoogleTeam(userId, user!)
    : null
  const admin = cellFor(region).createAdminClient()

  const { error: profileErr } = await admin
    .from("profile")
    .upsert({ id: userId, email }, { onConflict: "id", ignoreDuplicates: true })
  if (profileErr) {
    throw new Error(`Failed to create profile: ${profileErr.message}`)
  }

  // The promotion boundary must be told about registration failure before it
  // creates the team. The signed unavailable bit is intentionally derived
  // here from the server-side result; it is never a browser input.
  const creationBinding = {
    attemptId: creation?.attemptId ?? crypto.randomUUID(),
    teamId: creation?.teamId ?? crypto.randomUUID(),
  }
  let authorityUnavailable = false
  try {
    await registerPromotionSignupDevice(region, userId)
  } catch (error) {
    if (!(error instanceof PromotionEvidenceError)) {
      throw new Error("Promotion authority unavailable; please try again", {
        cause: error,
      })
    }
    if (error.code !== "evidence_missing") authorityUnavailable = true
    // Missing evidence is a policy input. The regional evidence-required gate
    // decides it, while a true authority failure must be pinned as no-credit.
  }

  const creationResult = await createTeamWithPromotionAttempt({
    userId,
    attemptId: creationBinding.attemptId,
    teamId: creationBinding.teamId,
    name,
    region,
    authorityUnavailable,
  })
  const team = { id: creationResult.teamId, name }

  try {
    const { error: memberErr } = await admin.from("team_member").insert({
      team_id: team.id,
      profile_id: userId,
      role: "owner",
    })
    if (memberErr) {
      throw new Error(`Failed to add team member: ${memberErr.message}`)
    }

    const { error: membershipErr } = await admin
      .from("team_memberships")
      .insert({ team_id: team.id, user_id: userId, status: "active" })
    if (membershipErr) {
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
        user_id: userId,
        role_id: role.id,
        scope_type: "team",
        team_id: team.id,
      })
    if (assignErr) {
      throw new Error(
        `Failed to assign ${TEAM_OWNER_ROLE}: ${assignErr.message}`,
      )
    }
  } catch (chainErr) {
    for (const [table, column] of [
      ["user_role_assignments", "team_id"],
      ["team_memberships", "team_id"],
      ["team_member", "team_id"],
    ] as const) {
      const { error: unwindErr } = await admin
        .from(table)
        .delete()
        .eq(column, team.id)
      if (unwindErr) {
        console.error(
          `provision-team unwind: failed to delete from ${table} for team ${team.id}: ${unwindErr.message}`,
        )
      }
    }
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
  return { id: team.id as string, name: team.name as string, region }
}
