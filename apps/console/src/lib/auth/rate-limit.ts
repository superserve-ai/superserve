import "server-only"
import crypto from "node:crypto"

import { cellFor, DEFAULT_REGION } from "@/lib/cells"

// Sliding-window limits for console auth endpoints. Counts live in the
// default cell, next to Auth, and only a keyed hash of each key is stored.

export type AuthRateLimit = {
  bucket: string
  max: number
  windowSeconds: number
}

/** "busy": another call held the key's lock, so nothing was counted. */
export type AuthRateLimitOutcome = "allowed" | "refused" | "busy"

type AdminClient = ReturnType<ReturnType<typeof cellFor>["createAdminClient"]>

let warnedMissingSecret = false

// Keys are IPs and email addresses. A plain SHA-256 of an IPv4 address or a
// guessed email is easy to recover from the table, so the hash is keyed with
// a server secret. Without the secret the limits keep working on plain
// SHA-256: failing closed would stop every reset and sign-in link email, and
// failing open would remove the limits.
function hashKey(limit: AuthRateLimit, key: string): string {
  const value = `${limit.bucket}:${key}`
  const secret = process.env.AUTH_RATE_LIMIT_KEY_SECRET?.trim()
  if (secret) {
    return crypto.createHmac("sha256", secret).update(value).digest("hex")
  }
  if (!warnedMissingSecret) {
    warnedMissingSecret = true
    console.error(
      "AUTH_RATE_LIMIT_KEY_SECRET is not set; auth rate limit keys use plain SHA-256",
    )
  }
  return crypto.createHash("sha256").update(value).digest("hex")
}

async function consume(
  client: AdminClient,
  limit: AuthRateLimit,
  keyHash: string,
): Promise<boolean> {
  const { data, error } = await client.rpc("consume_auth_rate_limit", {
    p_bucket: limit.bucket,
    p_key_hash: keyHash,
    p_max_per_window: limit.max,
    p_window: `${limit.windowSeconds} seconds`,
  })
  if (error) throw error
  return data !== false
}

/**
 * Records one attempt for `key` and returns false when the key already used
 * its budget in the window, or when a concurrent call held the key. If the
 * store cannot answer, the attempt is allowed: these limits sit behind
 * reCAPTCHA, and a store outage must not lock everyone out.
 */
export async function consumeAuthRateLimit(
  limit: AuthRateLimit,
  key: string,
): Promise<boolean> {
  try {
    return await consume(
      cellFor(DEFAULT_REGION).createAdminClient(),
      limit,
      hashKey(limit, key),
    )
  } catch (error) {
    console.error("Auth rate limit check failed:", limit.bucket, error)
    return true
  }
}

/**
 * Like consumeAuthRateLimit, but tells a used-up budget ("refused") apart
 * from a key that a concurrent call held locked ("busy"). Use it for a key
 * that many requests share, where a busy lock is normal and worth a retry.
 */
export async function consumeAuthRateLimitOutcome(
  limit: AuthRateLimit,
  key: string,
): Promise<AuthRateLimitOutcome> {
  const client = cellFor(DEFAULT_REGION).createAdminClient()
  const keyHash = hashKey(limit, key)
  try {
    if (await consume(client, limit, keyHash)) return "allowed"
  } catch (error) {
    console.error("Auth rate limit check failed:", limit.bucket, error)
    return "allowed"
  }
  // The store function returns false both when it finds the key locked and
  // when the budget is used up. It records only allowed attempts, so fewer
  // rows than the budget in the window means the lock was busy.
  try {
    const { count, error } = await client
      .from("auth_rate_limit_event")
      .select("bucket", { count: "exact", head: true })
      .eq("bucket", limit.bucket)
      .eq("key_hash", keyHash)
      .gt(
        "created_at",
        new Date(Date.now() - limit.windowSeconds * 1000).toISOString(),
      )
    if (error) throw error
    if (count === null) throw new Error("no count returned")
    return count >= limit.max ? "refused" : "busy"
  } catch (error) {
    console.error("Auth rate limit count failed:", limit.bucket, error)
    return "busy"
  }
}
