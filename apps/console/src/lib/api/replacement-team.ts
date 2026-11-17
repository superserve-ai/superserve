import { createHash } from "node:crypto"

// Persisted creation locators depend on this namespace remaining stable.
const REPLACEMENT_TEAM_NAMESPACE = Buffer.from(
  "7d90cf47bbcd43b996f43bdc4db12ad6",
  "hex",
)

export function replacementTeamOperationId(
  userId: string,
  removedTeamId: string,
): string {
  const bytes = createHash("sha1")
    .update(REPLACEMENT_TEAM_NAMESPACE)
    .update(`${userId}:${removedTeamId}`)
    .digest()
    .subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString("hex")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function replacementTeamName(name: string, operationId: string): string {
  const suffix = ` (${operationId.replaceAll("-", "").slice(0, 8)})`
  let prefix = ""
  let bytes = Buffer.byteLength(suffix, "utf8")
  for (const character of name) {
    const size = Buffer.byteLength(character, "utf8")
    if (bytes + size > 256) break
    prefix += character
    bytes += size
  }
  return prefix + suffix
}
