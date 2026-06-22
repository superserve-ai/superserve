import crypto from "node:crypto"

import { getProxySecret, hashKey } from "@/lib/api/proxy-secret"
import { createAdminClient } from "@/lib/supabase/admin"

export const IMPERSONATION_KEY_NAME = "__console_impersonation__"
const IMPERSONATION_KEY_VERSION = "v1"
const DEFAULT_TTL_MINUTES = 30

// In-process record of when each impersonation key's expires_at was last set.
// Lets us skip the api_key upsert on every proxied GET — we only re-write once
// the stored expiry falls within half the TTL of now. Losing this map across a
// restart or another instance only costs an extra idempotent upsert; the row's
// expires_at always stays in the future while a session is active. keyHash →
// expiresAt(ms).
const keyExpiryCache = new Map<string, number>()

/** Deterministic per (admin, team) so platform attribution stays per-individual. */
export function deriveImpersonationKey(
  adminId: string,
  teamId: string,
): string {
  const mac = crypto
    .createHmac("sha256", getProxySecret())
    .update(`imp:${IMPERSONATION_KEY_VERSION}:${adminId}:${teamId}`)
    .digest()
  return `ss_live_${mac.toString("base64url")}`
}

/**
 * Upsert the ephemeral api_key row mapping the impersonation key to the target
 * team. Refreshes expires_at and clears revoked_at on every call so an active
 * session stays valid; the backend rejects the key once expires_at passes.
 */
export async function ensureImpersonationKeyRow(
  adminId: string,
  teamId: string,
  ttlMinutes: number = DEFAULT_TTL_MINUTES,
): Promise<string> {
  const rawKey = deriveImpersonationKey(adminId, teamId)
  const keyHash = hashKey(rawKey)
  const ttlMs = ttlMinutes * 60_000
  const now = Date.now()

  // Skip the write while the row is comfortably unexpired — the common case on
  // a chatty read-only session that polls the proxy every few seconds.
  const cachedExpiry = keyExpiryCache.get(keyHash)
  if (cachedExpiry !== undefined && cachedExpiry - now > ttlMs / 2) {
    return rawKey
  }

  const expiresAtMs = now + ttlMs
  const admin = createAdminClient()
  const { error } = await admin.from("api_key").upsert(
    {
      team_id: teamId,
      key_hash: keyHash,
      name: IMPERSONATION_KEY_NAME,
      scopes: [],
      created_by: adminId,
      expires_at: new Date(expiresAtMs).toISOString(),
      revoked_at: null,
    },
    { onConflict: "key_hash" },
  )
  if (error)
    throw new Error(`Failed to ensure impersonation key: ${error.message}`)
  keyExpiryCache.set(keyHash, expiresAtMs)
  return rawKey
}

export async function revokeImpersonationKeyRow(
  adminId: string,
  teamId: string,
): Promise<void> {
  const rawKey = deriveImpersonationKey(adminId, teamId)
  const keyHash = hashKey(rawKey)
  const admin = createAdminClient()
  // Drop the cached expiry so a later re-start re-upserts (and clears
  // revoked_at) instead of trusting a now-stale "still valid" entry.
  keyExpiryCache.delete(keyHash)
  const { error } = await admin
    .from("api_key")
    .update({ revoked_at: new Date().toISOString() })
    .eq("key_hash", keyHash)
  if (error)
    throw new Error(`Failed to revoke impersonation key: ${error.message}`)
}
