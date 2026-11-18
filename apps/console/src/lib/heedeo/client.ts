import {
  encodeHeedeoCapture,
  HEEDEO_PROXY_PREFIX,
  HEEDEO_SIGNUP_COOKIE,
  HEEDEO_SIGNUP_COOKIE_MAX_AGE_SECONDS,
  HEEDEO_SIGNUP_COOKIE_PATH,
  type HeedeoCapture,
  isHeedeoToken,
} from "./shared"

export const HEEDEO_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_HEEDEO_KEY

/** The script, from the console's own origin (see `HEEDEO_PROXY_PREFIX`). */
export const HEEDEO_SCRIPT_SRC = HEEDEO_PUBLISHABLE_KEY
  ? `${HEEDEO_PROXY_PREFIX}/i.js?key=${encodeURIComponent(HEEDEO_PUBLISHABLE_KEY)}`
  : undefined

/**
 * How long a sign-up waits for Heedeo. `identify()` rejects within 3 s once
 * the script is loaded, and the capture runs beside the other sign-up checks,
 * so this is normally no extra wait at all.
 */
export const HEEDEO_CAPTURE_BUDGET_MS = 3000

declare global {
  interface Window {
    heedeo?: {
      identify(who?: {
        userId?: string | null
        email?: string | null
      }): Promise<{ token: string; visitor_id: string; confidence: number }>
    }
  }
}

const HEEDEO_TOKEN_COOKIE = "_idt"

let scriptRequested = false
let scriptFailed = false
let latestCapture = 0

/** Called when the script cannot load. */
export function markHeedeoScriptFailed(): void {
  scriptFailed = true
}

/**
 * Loads Heedeo's script from the console origin, once. Once loaded, the
 * script identifies the browser in the background ahead of `identify()`, so
 * do not load it with the page: load it when the visitor starts a sign-up
 * (see `heedeoPreloadProps`), and `captureHeedeoSignup` loads it at the
 * action when that has not happened.
 */
export function loadHeedeoScript(): void {
  if (!HEEDEO_SCRIPT_SRC || scriptRequested) return
  scriptRequested = true
  try {
    const script = document.createElement("script")
    script.src = HEEDEO_SCRIPT_SRC
    script.async = true
    script.onerror = markHeedeoScriptFailed
    document.head.appendChild(script)
  } catch {
    markHeedeoScriptFailed()
  }
}

/**
 * Spread on a sign-up control, so the script loads when the pointer reaches
 * it or it takes focus, a moment before the click. Never on a control that
 * only signs in.
 */
export const heedeoPreloadProps = {
  onPointerEnter: loadHeedeoScript,
  onFocus: loadHeedeoScript,
}

// A function call, so the wait loop reads the flag that `onError` sets later.
function hasScriptFailed(): boolean {
  return scriptFailed
}

function writeCookie(value: string, maxAge: number): void {
  try {
    const secure = window.location.protocol === "https:" ? "; Secure" : ""
    document.cookie = `${HEEDEO_SIGNUP_COOKIE}=${value}; Path=${HEEDEO_SIGNUP_COOKIE_PATH}; Max-Age=${maxAge}; SameSite=Lax${secure}`
  } catch {
    // Observation only.
  }
}

/** Removes an earlier capture, so a server call never reads a spent token. */
export function clearHeedeoSignupCapture(): void {
  writeCookie("", 0)
}

function clearHeedeoTokenCookie(): void {
  try {
    document.cookie = `${HEEDEO_TOKEN_COOKIE}=; Path=/; Max-Age=0`
  } catch {
    // Observation only.
  }
}

async function identifyWithin(
  budgetMs: number,
): Promise<Omit<HeedeoCapture, "latencyMs">> {
  const start = Date.now()
  while (!window.heedeo && !hasScriptFailed() && Date.now() - start < budgetMs)
    await new Promise((resolve) => setTimeout(resolve, 100))
  const heedeo = window.heedeo
  if (!heedeo)
    return {
      status: hasScriptFailed() ? "script_failed" : "script_timeout",
      token: null,
    }
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const identify = Promise.resolve(heedeo.identify())
    // The script also leaves the token in its own `_idt` cookie (Path=/).
    // The server reads the token from our `/auth` cookie, so drop `_idt`
    // when identify settles. A late write can bring it back, so the
    // analytics rewrite strips it too (`middleware.ts`).
    identify.then(clearHeedeoTokenCookie, clearHeedeoTokenCookie)
    const answer = await Promise.race([
      identify,
      new Promise<"timeout">((resolve) => {
        timer = setTimeout(
          () => resolve("timeout"),
          Math.max(budgetMs - (Date.now() - start), 0),
        )
      }),
    ])
    if (answer === "timeout") return { status: "identify_timeout", token: null }
    const token: unknown = answer?.token
    return isHeedeoToken(token)
      ? { status: "ok", token }
      : { status: "invalid_response", token: null }
  } catch {
    return { status: "identify_error", token: null }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Identifies this browser with Heedeo for the sign-up observation and leaves
 * the result in a short-lived cookie for the server. Call it at the action,
 * just before the sign-up server call or the trip to Google, and wait for it
 * before that call. It never throws and resolves within `budgetMs`.
 *
 * Observation only: nothing in the sign-up depends on it. When the script is
 * blocked or slow, the cookie records why, and the server still sends the
 * event without a token.
 */
export async function captureHeedeoSignup(
  budgetMs: number = HEEDEO_CAPTURE_BUDGET_MS,
): Promise<void> {
  if (!HEEDEO_PUBLISHABLE_KEY) return
  const run = ++latestCapture
  try {
    loadHeedeoScript()
    clearHeedeoSignupCapture()
    const start = Date.now()
    const result = await identifyWithin(budgetMs)
    // A newer capture owns the cookie now.
    if (run !== latestCapture) return
    writeCookie(
      encodeHeedeoCapture({ ...result, latencyMs: Date.now() - start }),
      HEEDEO_SIGNUP_COOKIE_MAX_AGE_SECONDS,
    )
  } catch {
    // Observation only.
  }
}
