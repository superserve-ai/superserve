"use server"

import { getOrCreateTeamForUser, mintTeamApiKey } from "@/lib/api/api-key-mint"
import type { TeamMembership } from "@/lib/api/team-directory"
import { GoogleSignupRecoveryRequiredError } from "@/lib/auth/google-signup-proof"
import {
  SignupRestrictedError,
  SIGNUP_RESTRICTED_MESSAGE,
} from "@/lib/auth/signup-restrictions"
import { assertSignupReviewCleared } from "@/lib/auth/signup-review"
import { cellFor } from "@/lib/cells"
import { createServerClient } from "@/lib/supabase/server"

const SIGNUP_DENIAL = {
  code: "signup_blocked" as const,
  message: SIGNUP_RESTRICTED_MESSAGE,
}
const GOOGLE_RECOVERY = {
  code: "google_signup_recovery_required" as const,
  message: "Complete signup with Google to continue.",
}

export async function listApiKeysAction() {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const observedAt = new Date().toISOString()
  if (!user) throw new Error("Not authenticated")

  let team: TeamMembership
  try {
    team = await getOrCreateTeamForUser(user, observedAt)
  } catch (error) {
    if (error instanceof SignupRestrictedError) return SIGNUP_DENIAL
    if (error instanceof GoogleSignupRecoveryRequiredError)
      return GOOGLE_RECOVERY
    throw error
  }

  const admin = cellFor(team.region).createAdminClient()
  const { data, error } = await admin
    .from("api_key")
    .select("id, name, key_hash, created_at, last_used_at")
    .eq("team_id", team.teamId)
    .is("revoked_at", null)
    .neq("name", "__console_proxy__")
    .order("created_at", { ascending: false })

  if (error) throw new Error(error.message)

  return (data ?? []).map((k) => ({
    id: k.id as string,
    name: k.name as string,
    prefix: `${(k.key_hash as string).slice(0, 8)}...`,
    created_at: k.created_at as string,
    last_used_at: k.last_used_at as string | null,
  }))
}

export async function createApiKeyAction(name: string) {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const observedAt = new Date().toISOString()
  if (!user) throw new Error("Not authenticated")
  assertSignupReviewCleared(user)

  let team: TeamMembership
  try {
    team = await getOrCreateTeamForUser(user, observedAt)
  } catch (error) {
    if (error instanceof SignupRestrictedError) return SIGNUP_DENIAL
    if (error instanceof GoogleSignupRecoveryRequiredError)
      return GOOGLE_RECOVERY
    throw error
  }

  return mintTeamApiKey(user, team, name, observedAt)
}

export async function revokeApiKeyAction(id: string) {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const observedAt = new Date().toISOString()
  if (!user) throw new Error("Not authenticated")

  let team: TeamMembership
  try {
    team = await getOrCreateTeamForUser(user, observedAt)
  } catch (error) {
    if (error instanceof SignupRestrictedError) return SIGNUP_DENIAL
    if (error instanceof GoogleSignupRecoveryRequiredError)
      return GOOGLE_RECOVERY
    throw error
  }

  const admin = cellFor(team.region).createAdminClient()
  const { error } = await admin
    .from("api_key")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("team_id", team.teamId)

  if (error) throw new Error(error.message)
}
