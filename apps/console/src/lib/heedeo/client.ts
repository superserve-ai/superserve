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
// Each capture's own run, so `settleHeedeoSignup` acts only on its capture.
type CaptureRun = { run: number; start: number; identifyStarted: boolean }
const captureRuns = new WeakMap<Promise<void>, CaptureRun>()

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

// Same for the capture counter that `settleHeedeoSignup` moves on, and for
// the attempt's signal, which its caller aborts once it has given up.
function isLiveCapture(run: number, signal: AbortSignal | undefined): boolean {
  return run === latestCapture && !signal?.aborted
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
  own: CaptureRun,
  signal: AbortSignal | undefined,
): Promise<Omit<HeedeoCapture, "latencyMs">> {
  const { run, start } = own
  while (
    !window.heedeo &&
    !hasScriptFailed() &&
    isLiveCapture(run, signal) &&
    Date.now() - start < budgetMs
  )
    await new Promise((resolve) => setTimeout(resolve, 100))
  const heedeo = window.heedeo
  // A capture that `settleHeedeoSignup` or its attempt gave up on, or whose
  // budget is spent, must not start a billed `identify()` nobody reads.
  if (!heedeo || !isLiveCapture(run, signal) || Date.now() - start >= budgetMs)
    return {
      status: hasScriptFailed() ? "script_failed" : "script_timeout",
      token: null,
    }
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    own.identifyStarted = true
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
 *
 * Abort `signal` when the attempt stops before its server call or the trip
 * to Google (a failed check, an error, a page that unmounts): the capture
 * then starts no `identify()` and writes no cookie. Aborting it does not
 * touch a newer capture.
 */
export function captureHeedeoSignup(
  budgetMs: number = HEEDEO_CAPTURE_BUDGET_MS,
  signal?: AbortSignal,
): Promise<void> {
  if (!HEEDEO_PUBLISHABLE_KEY) return Promise.resolve()
  const own = {
    run: ++latestCapture,
    start: Date.now(),
    identifyStarted: false,
  }
  const capture = runCapture(budgetMs, own, signal)
  captureRuns.set(capture, own)
  return capture
}

async function runCapture(
  budgetMs: number,
  own: CaptureRun,
  signal: AbortSignal | undefined,
): Promise<void> {
  try {
    loadHeedeoScript()
    clearHeedeoSignupCapture()
    const result = await identifyWithin(budgetMs, own, signal)
    // A newer capture owns the cookie now, or nobody reads this one.
    if (!isLiveCapture(own.run, signal)) return
    writeCookie(
      encodeHeedeoCapture({ ...result, latencyMs: Date.now() - own.start }),
      HEEDEO_SIGNUP_COOKIE_MAX_AGE_SECONDS,
    )
  } catch {
    // Observation only.
  }
}

/**
 * How long the email sign-up still waits for Heedeo once its other checks are
 * done. The email action reads the cookie, so unlike the Google paths it
 * cannot overlap the server call; a slow Heedeo costs it at most this much.
 */
export const HEEDEO_SIGNUP_TAIL_MS = 1000

/**
 * Waits for a running `captureHeedeoSignup` for at most `tailMs` more. When
 * it is still running, records the timeout for the server at once and drops
 * the late result. Acts only while `capture` is the latest capture, so an
 * older attempt never overwrites a newer one. Never throws.
 */
export async function settleHeedeoSignup(
  capture: Promise<void>,
  tailMs: number = HEEDEO_SIGNUP_TAIL_MS,
): Promise<void> {
  const own = captureRuns.get(capture)
  if (!own) return
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const finished = await Promise.race([
      capture.then(
        () => true,
        () => true,
      ),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), tailMs)
      }),
    ])
    if (finished || own.run !== latestCapture) return
    latestCapture++
    writeCookie(
      encodeHeedeoCapture({
        status: own.identifyStarted
          ? "identify_timeout"
          : hasScriptFailed()
            ? "script_failed"
            : "script_timeout",
        token: null,
        latencyMs: Date.now() - own.start,
      }),
      HEEDEO_SIGNUP_COOKIE_MAX_AGE_SECONDS,
    )
  } catch {
    // Observation only.
  } finally {
    clearTimeout(timer)
  }
}
