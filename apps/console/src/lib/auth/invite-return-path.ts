// Invite links carry the region in the token itself so the invite page can pick
// the right cell before anyone is signed in. Both the region and the 43-char
// base64url body are validated strictly: this value is echoed into redirects,
// so anything looser would be an open-redirect surface.
const INVITE_TOKEN_PATTERN = /^ssinv_(use|usw)_[A-Za-z0-9_-]{43}$/

export const INVITE_PATH_PREFIX = "/invite/"

export type InviteTokenRegion = "use" | "usw"

export function isInviteToken(raw: unknown): raw is string {
  return typeof raw === "string" && INVITE_TOKEN_PATTERN.test(raw)
}

export function inviteTokenRegion(raw: unknown): InviteTokenRegion | null {
  if (!isInviteToken(raw)) return null
  return raw.split("_")[1] as InviteTokenRegion
}

export function invitePath(token: string): string | null {
  return isInviteToken(token) ? `${INVITE_PATH_PREFIX}${token}` : null
}

// Accepts exactly `/invite/<token>` (optionally with the app's trailing slash)
// and nothing else: no query, no hash, no extra segments.
export function inviteReturnPath(raw: string | null | undefined) {
  if (!raw || !raw.startsWith(INVITE_PATH_PREFIX)) return null
  const token = raw.slice(INVITE_PATH_PREFIX.length).replace(/\/$/, "")
  return invitePath(token)
}

// Token carried by an invite return path, or null for any other path.
export function inviteTokenFromReturnPath(
  raw: string | null | undefined,
): string | null {
  const path = inviteReturnPath(raw)
  return path ? path.slice(INVITE_PATH_PREFIX.length) : null
}
