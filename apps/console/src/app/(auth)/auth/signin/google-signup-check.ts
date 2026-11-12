import {
  beginGoogleSignup,
  isCloudflareSignupObservationEnabled,
} from "@/app/(auth)/auth/signup/action"
import {
  TURNSTILE_SITE_KEY,
  getTurnstileToken,
} from "@/lib/cloudflare/turnstile-client"
import {
  ensureFingerprintSignupCapture,
  getFingerprintSignupDiagnostics,
} from "@/lib/fingerprint/client"
import { RECAPTCHA_SITE_KEY, getRecaptchaToken } from "@/lib/recaptcha/client"

/**
 * How long the sign-in page waits for the Google sign-up check before it goes
 * to Google without it. The check is optional: an existing account needs no
 * proof, and a new account without one still goes to the "Complete signup"
 * recovery page, where the same check runs again. A normal check is a
 * fingerprint capture, a reCAPTCHA token and one server call, and takes about
 * two to three seconds. Four seconds covers a slow network without making a
 * returning user wait on a stalled step: reCAPTCHA alone can wait eight
 * seconds for its script, and the server call can wait on two providers.
 */
export const GOOGLE_SIGNUP_CHECK_DEADLINE_MS = 4000

/**
 * The Cloudflare Turnstile token is observation only, so it gets less time
 * than the check and never holds back the proof. It runs beside the capture
 * and reCAPTCHA, and this limit leaves the server call most of the deadline.
 */
const TURNSTILE_BUDGET_MS = 2500

// Only the newest call may act. See `googleSignupAttemptForSignIn`.
let latestCheck = 0
let latestAbort: AbortController | undefined

/**
 * A token within the budget, or undefined. When the budget runs out, or the
 * check is cancelled, the work stops: a late answer from the flag lookup
 * starts no widget, and a widget already on the page is removed.
 */
function turnstileTokenWithinBudget(
  cancelled: AbortSignal,
): Promise<string | undefined> {
  if (!TURNSTILE_SITE_KEY) return Promise.resolve(undefined)
  return new Promise((resolve) => {
    const own = new AbortController()
    const stop = () => own.abort()
    const timer = setTimeout(stop, TURNSTILE_BUDGET_MS)
    cancelled.addEventListener("abort", stop, { once: true })
    own.signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer)
        resolve(undefined)
      },
      { once: true },
    )
    isCloudflareSignupObservationEnabled()
      .then((enabled) =>
        enabled && !own.signal.aborted
          ? getTurnstileToken(own.signal)
          : undefined,
      )
      .catch(() => undefined)
      .then((token) => {
        clearTimeout(timer)
        cancelled.removeEventListener("abort", stop)
        resolve(token)
      })
  })
}

async function runCheck(
  isCurrent: () => boolean,
  cancelled: AbortSignal,
): Promise<string | undefined> {
  const turnstile = turnstileTokenWithinBudget(cancelled)
  const capture = await ensureFingerprintSignupCapture()
  if (!isCurrent()) return undefined
  const diagnostics = getFingerprintSignupDiagnostics()
  const recaptchaToken = await getRecaptchaToken("signup_google")
  if (!isCurrent()) return undefined
  if (RECAPTCHA_SITE_KEY && !recaptchaToken) return undefined
  const turnstileToken = await turnstile
  // The last point where the check can be stopped: the server call below
  // replaces the evidence cookie and issues the proof cookie.
  if (!isCurrent()) return undefined
  const proof = await beginGoogleSignup(
    recaptchaToken,
    turnstileToken,
    capture,
    diagnostics,
    "signin",
  )
  return proof.success ? proof.signupAttemptId : undefined
}

/**
 * Runs the Google sign-up check (fingerprint capture, the `signup_google`
 * reCAPTCHA, and the signed proof cookie) before the sign-in page sends the
 * browser to Google. The sign-in page cannot know if the Google account is
 * new, so it runs the check for every Google sign-in. A new account then has
 * its proof at the first callback and does not go to Google a second time.
 *
 * The check stops waiting after `deadlineMs`, so a stalled capture, reCAPTCHA
 * or proof call cannot hold back a returning user. A call that is past its
 * deadline, or that a newer call has replaced, is cancelled: it starts no
 * further step and returns nothing. In particular it never reaches the server
 * call that replaces the evidence cookie and issues the proof cookie, so a
 * late step cannot write over the evidence of a later attempt. A server call
 * already sent when the deadline passes cannot be recalled, but Next.js runs a
 * page's server actions one at a time: its response, with its cookies, is
 * applied before any later action is sent, so it cannot land on top of a newer
 * attempt. Its proof cookie is named for its own attempt ID, and the callback
 * URL does not carry that ID. Because of the same queue, a later action waits
 * for the call to finish; the call is bounded by the server's own provider
 * timeouts (reCAPTCHA, fingerprint lookup, backend), so the wait is short.
 * If the capture is still running at the deadline, the page leaves with its
 * stored attempt still marked pending, and the recovery page reports that
 * capture as unavailable instead of starting a second one for the same
 * session. That is how the capture treats any reload, and the proof then
 * follows the backend's policy for missing evidence.
 * Cancelling also removes the Turnstile widget the check added, and stops a
 * late feature-flag answer from adding one. A fingerprint capture left running
 * is the shared capture of the page, which the next attempt, or the recovery
 * page, reuses.
 *
 * Returns the sign-up attempt ID for the callback URL, or undefined when the
 * check fails or runs out of time. Sign-in continues either way.
 */
export function googleSignupAttemptForSignIn(
  deadlineMs: number = GOOGLE_SIGNUP_CHECK_DEADLINE_MS,
): Promise<string | undefined> {
  const check = ++latestCheck
  latestAbort?.abort()
  const abort = new AbortController()
  latestAbort = abort
  const isCurrent = () => !abort.signal.aborted && check === latestCheck
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      abort.abort()
      resolve(undefined)
    }, deadlineMs)
    runCheck(isCurrent, abort.signal).then(
      (attemptId) => {
        clearTimeout(timer)
        // A result that arrives after the deadline is not used.
        const result = isCurrent() ? attemptId : undefined
        abort.abort()
        resolve(result)
      },
      () => {
        clearTimeout(timer)
        abort.abort()
        resolve(undefined)
      },
    )
  })
}
