import { randomBytes, timingSafeEqual } from "node:crypto"

/**
 * Email links (sign-up confirmation, password reset, email sign-in) carry a
 * one-time token. Mail scanners and link previews open links with GET, so the
 * callback must not use the token on GET. Instead the GET saves the link's
 * query in a short-lived, httpOnly cookie and shows a confirm page. The token
 * is used only when that page posts back with the matching CSRF value.
 *
 * The token stays out of the confirm page URL, so browser history and page
 * scripts never see it. The cookie uses path `/`, so the middleware removes
 * cookies from analytics requests before they leave the console.
 */

export const EMAIL_LINK_CONFIRM_PATH = "/auth/confirm/"
export const EMAIL_LINK_CALLBACK_PATH = "/auth/callback/"
export const EMAIL_LINK_CSRF_FIELD = "csrf"
const COOKIE_BASE_NAME = "ss_email_link"
const COOKIE_MAX_AGE_SECONDS = 15 * 60
// The link query holds a token hash plus a few short flags; anything much
// larger is not a link this app wrote.
const MAX_QUERY_LENGTH = 2048

export type EmailLinkType =
  | "signup"
  | "recovery"
  | "invite"
  | "magiclink"
  | "email"

const EMAIL_LINK_TYPES = new Set<string>([
  "signup",
  "recovery",
  "invite",
  "magiclink",
  "email",
])

export function isEmailLinkType(value: string | null): value is EmailLinkType {
  return value !== null && EMAIL_LINK_TYPES.has(value)
}

/**
 * `__Host-` cookies must be Secure, path `/`, and have no Domain, so another
 * subdomain cannot set or overwrite them. Plain-HTTP local development cannot
 * use the prefix.
 */
export function emailLinkCookieName(secure: boolean): string {
  return secure ? `__Host-${COOKIE_BASE_NAME}` : COOKIE_BASE_NAME
}

export function emailLinkCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  }
}

export interface PendingEmailLink {
  csrf: string
  query: string
}

export function newPendingEmailLink(params: URLSearchParams): PendingEmailLink {
  const query = new URLSearchParams(params)
  // An empty `code=` is not an OAuth code; drop it so the saved link is a
  // plain token link.
  query.delete("code")
  return {
    csrf: randomBytes(32).toString("base64url"),
    query: query.toString(),
  }
}

export function encodePendingEmailLink(link: PendingEmailLink): string {
  return Buffer.from(JSON.stringify(link), "utf8").toString("base64url")
}

export function decodePendingEmailLink(
  raw: string | undefined | null,
): PendingEmailLink | null {
  if (!raw || raw.length > MAX_QUERY_LENGTH * 2) return null
  try {
    const value: unknown = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf8"),
    )
    if (
      typeof value !== "object" ||
      value === null ||
      typeof (value as PendingEmailLink).csrf !== "string" ||
      typeof (value as PendingEmailLink).query !== "string"
    )
      return null
    const { csrf, query } = value as PendingEmailLink
    if (csrf.length < 32 || query.length > MAX_QUERY_LENGTH) return null
    const params = new URLSearchParams(query)
    // Only token links use this step; the OAuth code flow stays on GET.
    if (!params.get("token_hash") || params.get("code")) return null
    return { csrf, query }
  } catch {
    return null
  }
}

export function csrfMatches(expected: string, received: unknown): boolean {
  if (typeof received !== "string") return false
  const a = Buffer.from(expected, "utf8")
  const b = Buffer.from(received, "utf8")
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Accepts only a form post from this site. Browsers send `Sec-Fetch-Site` on
 * every request; older ones still send `Origin` on a form POST. A request with
 * neither is refused.
 */
export function isSameOriginPost(request: Request): boolean {
  const fetchSite = request.headers.get("sec-fetch-site")
  if (fetchSite) return fetchSite === "same-origin"
  const origin = request.headers.get("origin")
  return origin !== null && origin === new URL(request.url).origin
}

/** Reads one cookie from a request's Cookie header. */
export function readRequestCookie(
  request: Request,
  name: string,
): string | null {
  const header = request.headers.get("cookie")
  if (!header) return null
  for (const part of header.split(";")) {
    const index = part.indexOf("=")
    if (index === -1) continue
    if (part.slice(0, index).trim() === name) {
      const value = part.slice(index + 1).trim()
      try {
        return decodeURIComponent(value)
      } catch {
        return value
      }
    }
  }
  return null
}
