"use server"

import crypto from "node:crypto"
import { createAdminClient } from "@superserve/supabase/admin"
import { createServerClient } from "@superserve/supabase/server"

function generateRawKey(): string {
  const bytes = crypto.randomBytes(24)
  return `ss_live_${bytes.toString("base64url")}`
}

function hashKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex")
}

/**
 * Ensure a profile row exists for the authenticated user.
 * The Go backend schema requires profile(id) to match auth.users(id).
 */
async function ensureProfile(userId: string, email: string): Promise<void> {
  const admin = createAdminClient()
  const { data: existing } = await admin
    .from("profile")
    .select("id")
    .eq("id", userId)
    .single()

  if (existing) return

  const { error } = await admin.from("profile").insert({
    id: userId,
    email,
  })

  // Ignore unique-violation (23505) — profile was created concurrently
  if (error && !error.message.includes("duplicate key")) {
    throw new Error(`Failed to create profile: ${error.message}`)
  }
}

/**
 * Look up the user's team via team_member. If no team exists,
 * auto-create one (named after their email) and add them as owner.
 */
async function getOrCreateTeamForUser(
  userId: string,
  email: string,
): Promise<string> {
  const admin = createAdminClient()

  // Ensure profile exists first (FK target for team_member and api_key)
  await ensureProfile(userId, email)

  // Try to find existing team membership
  const { data: membership } = await admin
    .from("team_member")
    .select("team_id")
    .eq("profile_id", userId)
    .limit(1)
    .single()

  if (membership?.team_id) return membership.team_id

  // No team — create one and add user as owner
  const { data: team, error: teamErr } = await admin
    .from("team")
    .insert({ name: email })
    .select("id")
    .single()

  if (teamErr) throw new Error(`Failed to create team: ${teamErr.message}`)

  const { error: memberErr } = await admin.from("team_member").insert({
    team_id: team.id,
    profile_id: userId,
    role: "owner",
  })

  if (memberErr)
    throw new Error(`Failed to add team member: ${memberErr.message}`)

  return team.id as string
}

export async function listApiKeysAction() {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Not authenticated")

  const teamId = await getOrCreateTeamForUser(user.id, user.email ?? user.id)

  const admin = createAdminClient()
  const { data, error } = await admin
    .from("api_key")
    .select("id, name, key_hash, created_at, last_used_at")
    .eq("team_id", teamId)
    .is("revoked_at", null)
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
  if (!user) throw new Error("Not authenticated")

  const teamId = await getOrCreateTeamForUser(user.id, user.email ?? user.id)

  const rawKey = generateRawKey()
  const keyHash = hashKey(rawKey)
  const keyPrefix = `ss_live_${rawKey.slice(8, 16)}...`

  const admin = createAdminClient()
  const { data, error } = await admin
    .from("api_key")
    .insert({
      team_id: teamId,
      key_hash: keyHash,
      name,
      scopes: [],
      created_by: user.id,
    })
    .select("id, name, created_at")
    .single()

  if (error) throw new Error(error.message)

  return {
    id: data.id as string,
    name: data.name as string,
    key: rawKey,
    prefix: keyPrefix,
    created_at: data.created_at as string,
  }
}

export async function revokeApiKeyAction(id: string) {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Not authenticated")

  const teamId = await getOrCreateTeamForUser(user.id, user.email ?? user.id)

  const admin = createAdminClient()
  const { error } = await admin
    .from("api_key")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("team_id", teamId)

  if (error) throw new Error(error.message)
}
