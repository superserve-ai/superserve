import crypto from "node:crypto"
import { createAdminClient } from "@superserve/supabase/admin"
import { createServerClient } from "@superserve/supabase/server"

const PROXY_KEY_NAME = "__console_proxy__"
const CACHE_TTL_MS = 60_000

interface CacheEntry {
  key: string
  expiresAt: number
}

const keyCache = new Map<string, CacheEntry>()
const inflightRequests = new Map<string, Promise<string>>()

function generateRawKey(): string {
  const bytes = crypto.randomBytes(24)
  return `ss_live_${bytes.toString("base64url")}`
}

function hashKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex")
}

async function ensureProfile(
  userId: string,
  email: string,
): Promise<void> {
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

  if (error && !error.message.includes("duplicate key")) {
    throw new Error(`Failed to create profile: ${error.message}`)
  }
}

async function getTeamForUser(userId: string, email: string): Promise<string> {
  const admin = createAdminClient()

  await ensureProfile(userId, email)

  const { data: membership } = await admin
    .from("team_member")
    .select("team_id")
    .eq("profile_id", userId)
    .limit(1)
    .single()

  if (membership?.team_id) return membership.team_id

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

async function resolveApiKey(userId: string, email: string): Promise<string> {
  const teamId = await getTeamForUser(userId, email)
  const admin = createAdminClient()

  // Revoke any existing proxy key and create a fresh one.
  // We can't recover the plaintext of an existing key, so always rotate.
  const { data: existing } = await admin
    .from("api_key")
    .select("id")
    .eq("team_id", teamId)
    .eq("name", PROXY_KEY_NAME)
    .is("revoked_at", null)
    .limit(1)
    .single()

  if (existing) {
    await admin
      .from("api_key")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", existing.id)
  }

  const rawKey = generateRawKey()
  const keyHash = hashKey(rawKey)

  const { error } = await admin.from("api_key").insert({
    team_id: teamId,
    key_hash: keyHash,
    name: PROXY_KEY_NAME,
    scopes: [],
    created_by: userId,
  })

  if (error) throw new Error(`Failed to create proxy key: ${error.message}`)

  return rawKey
}

async function getProxyApiKey(userId: string, email: string): Promise<string> {
  const cached = keyCache.get(userId)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.key
  }

  // Dedup concurrent requests for the same user
  const inflight = inflightRequests.get(userId)
  if (inflight) return inflight

  const promise = resolveApiKey(userId, email).then((key) => {
    keyCache.set(userId, { key, expiresAt: Date.now() + CACHE_TTL_MS })
    inflightRequests.delete(userId)
    return key
  })

  inflightRequests.set(userId, promise)
  return promise
}

/**
 * Authenticate the current request and return the API key to inject.
 * Returns null if the user is not authenticated.
 */
export async function getAuthApiKey(): Promise<string | null> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  return getProxyApiKey(user.id, user.email ?? user.id)
}
