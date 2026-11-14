import { createHash } from "node:crypto"

// Persisted creation locators must use the same namespace on every retry.
const FALLBACK_NAMESPACE = Buffer.from(
  "a60c9f0b75584e32b7dda9cbb50a31f4",
  "hex",
)

// Version 5 bits keep this distinct from the v4 auth user id, which is
// reserved for the automatic initial creation.
export function accountTeamFallbackOperationId(userId: string): string {
  const bytes = createHash("sha1")
    .update(FALLBACK_NAMESPACE)
    .update(userId)
    .digest()
    .subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString("hex")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function accountTeamFallbackName(email: string, userId: string): string {
  const suffix = ` (${userId.replaceAll("-", "").slice(0, 8)})`
  const limit = 256 - Buffer.byteLength(suffix, "utf8")
  let prefix = ""
  let size = 0
  for (const point of email) {
    size += Buffer.byteLength(point, "utf8")
    if (size > limit) break
    prefix += point
  }
  return `${prefix}${suffix}`
}
