import "server-only"
import crypto from "node:crypto"

import { cellFor, DEFAULT_REGION } from "@/lib/cells"

// Sliding-window limits for console auth endpoints. Counts live in the
// default cell, next to Auth, and only a SHA-256 of each key is stored.

export type AuthRateLimit = {
  bucket: string
  max: number
  windowSeconds: number
}

/**
 * Records one attempt for `key` and returns false when the key already used
 * its budget in the window. If the store cannot answer, the attempt is
 * allowed: these limits sit behind reCAPTCHA, and a store outage must not
 * lock everyone out.
 */
export async function consumeAuthRateLimit(
  limit: AuthRateLimit,
  key: string,
): Promise<boolean> {
  try {
    const { data, error } = await cellFor(DEFAULT_REGION)
      .createAdminClient()
      .rpc("consume_auth_rate_limit", {
        p_bucket: limit.bucket,
        p_key_hash: crypto
          .createHash("sha256")
          .update(`${limit.bucket}:${key}`)
          .digest("hex"),
        p_max_per_window: limit.max,
        p_window: `${limit.windowSeconds} seconds`,
      })
    if (error) throw error
    return data !== false
  } catch (error) {
    console.error("Auth rate limit check failed:", limit.bucket, error)
    return true
  }
}
