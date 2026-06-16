import crypto from "node:crypto"

import { getProxySecret, hashKey } from "@/lib/api/proxy-secret"
import { createAdminClient } from "@/lib/supabase/admin"

export const IMPERSONATION_KEY_NAME = "__console_impersonation__"
const IMPERSONATION_KEY_VERSION = "v1"
const DEFAULT_TTL_MINUTES = 30

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
  const admin = createAdminClient()
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString()
  const { error } = await admin.from("api_key").upsert(
    {
      team_id: teamId,
      key_hash: hashKey(rawKey),
      name: IMPERSONATION_KEY_NAME,
      scopes: [],
      created_by: adminId,
      expires_at: expiresAt,
      revoked_at: null,
    },
    { onConflict: "key_hash" },
  )
  if (error)
    throw new Error(`Failed to ensure impersonation key: ${error.message}`)
  return rawKey
}

export async function revokeImpersonationKeyRow(
  adminId: string,
  teamId: string,
): Promise<void> {
  const rawKey = deriveImpersonationKey(adminId, teamId)
  const admin = createAdminClient()
  await admin
    .from("api_key")
    .update({ revoked_at: new Date().toISOString() })
    .eq("key_hash", hashKey(rawKey))
}
