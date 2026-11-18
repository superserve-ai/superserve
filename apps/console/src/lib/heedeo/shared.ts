// Values shared by the browser capture and the server observation. Safe to
// import in client components: no secrets and no server-only modules.

/**
 * Where the console serves Heedeo's script and identify endpoint, through
 * `app/api/dv/[...path]/route.ts`. The script posts identify relative to its
 * own URL, so both paths sit under this prefix on the console origin. The
 * prefix names neither Heedeo nor tracking, so a blocking list that names
 * Heedeo's hosts does not match it.
 */
export const HEEDEO_PROXY_PREFIX = "/api/dv"

/**
 * The browser writes the result of `identify()` here just before the sign-up
 * server action (email) or the trip to Google, and the server reads and
 * deletes it. Heedeo's token lives five minutes and is good for one event, so
 * the cookie lives as long. `/auth` covers the sign-up page, the sign-in page
 * and the OAuth callback.
 */
export const HEEDEO_SIGNUP_COOKIE = "superserve-heedeo-signup"
export const HEEDEO_SIGNUP_COOKIE_PATH = "/auth"
export const HEEDEO_SIGNUP_COOKIE_MAX_AGE_SECONDS = 300

export const HEEDEO_CAPTURE_STATUSES = [
  "ok",
  // The script's onError fired: blocked, network error or a proxy error.
  "script_failed",
  // The script did not install `window.heedeo` within the budget.
  "script_timeout",
  "identify_timeout",
  "identify_error",
  "invalid_response",
] as const

export type HeedeoCaptureStatus = (typeof HEEDEO_CAPTURE_STATUSES)[number]

/** What the browser reports. Client-written, so the server treats it as untrusted. */
export type HeedeoCapture = {
  status: HeedeoCaptureStatus
  token: string | null
  latencyMs: number | null
}

// The API accepts tokens up to 4096 characters. A cookie holds about 4 KB,
// so a token longer than this never reaches the server anyway.
const TOKEN = /^[A-Za-z0-9._~+/=-]{1,3000}$/

export const isHeedeoToken = (value: unknown): value is string =>
  typeof value === "string" && TOKEN.test(value)

export function encodeHeedeoCapture(capture: HeedeoCapture): string {
  return encodeURIComponent(
    JSON.stringify({
      v: 1,
      s: capture.status,
      t: capture.token,
      ms: capture.latencyMs,
    }),
  )
}

function parse(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    try {
      return JSON.parse(decodeURIComponent(raw))
    } catch {
      return null
    }
  }
}

/** The capture, or null when the value is missing or not one we wrote. */
export function decodeHeedeoCapture(
  raw: string | undefined | null,
): HeedeoCapture | null {
  if (!raw || raw.length > 4096) return null
  const data = parse(raw)
  if (!data || typeof data !== "object" || Array.isArray(data)) return null
  const value = data as Record<string, unknown>
  if (value.v !== 1) return null
  const status = HEEDEO_CAPTURE_STATUSES.find((s) => s === value.s)
  if (!status) return null
  const token = isHeedeoToken(value.t) ? value.t : null
  if (status === "ok" && !token) return null
  const latencyMs =
    typeof value.ms === "number" &&
    Number.isFinite(value.ms) &&
    value.ms >= 0 &&
    value.ms <= 600_000
      ? Math.round(value.ms)
      : null
  return { status, token: status === "ok" ? token : null, latencyMs }
}
