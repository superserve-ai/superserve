import {
  beginGoogleSignup,
  isCloudflareSignupObservationEnabled,
} from "@/app/(auth)/auth/signup/action"
import {
  TURNSTILE_SITE_KEY,
  getTurnstileToken,
} from "@/lib/cloudflare/turnstile-client"
import {
  type SignupFingerprintResult,
  ensureFingerprintSignupCapture,
  getFingerprintSignupDiagnostics,
} from "@/lib/fingerprint/client"
import { RECAPTCHA_SITE_KEY, getRecaptchaToken } from "@/lib/recaptcha/client"

/**
 * How long the sign-in page waits for the browser steps of the Google sign-up
 * check (fingerprint capture, reCAPTCHA token, Turnstile token) before it goes
 * to Google without the check. The check is optional: an existing account
 * needs no proof, and a new account without one still goes to the "Complete
 * signup" recovery page, where the same check runs again. The capture and
 * reCAPTCHA run side by side and normally take one to two seconds. reCAPTCHA
 * alone can wait eight seconds for its script, so a stalled step must not hold
 * back a returning user for longer than this.
 */
export const GOOGLE_SIGNUP_CHECK_DEADLINE_MS = 4000

/**
 * The longest the check can take, counted from its start, once its server call
 * is sent. The server verifies reCAPTCHA, looks up the fingerprint and issues
 * the proof cookie, which can take a few seconds on its own. A proof that
 * arrives inside this limit is used, so a new account does not go to Google a
 * second time only because the server answered after the browser deadline.
 */
export const GOOGLE_SIGNUP_PROOF_DEADLINE_MS = 8000

/**
 * The fingerprint capture gets less time than the browser deadline, so that a
 * slow capture leaves time for the server call. When it runs out, the check
 * reports the capture as unavailable. That is the same evidence the recovery
 * page sends for a capture that did not finish, so the proof follows the
 * backend's policy for missing evidence, as it would on that page. A capture
 * that finishes later still writes its event cookie, which the callback reads.
 */
const FINGERPRINT_CAPTURE_BUDGET_MS = 3000

/**
 * The Cloudflare Turnstile token is observation only, so it gets less time
 * than the check and never holds back the proof. It runs beside the capture
 * and reCAPTCHA, and this limit leaves the server call most of the deadline.
 */
const TURNSTILE_BUDGET_MS = 2500

// Only the newest call may act. See `googleSignupAttemptForSignIn`.
let latestCheck = 0
let latestAbort: AbortController | undefined
// The Cloudflare flag lookup sent when the page loaded. The next check uses it.
let prefetchedFlag: Promise<boolean> | undefined

/**
 * Asks for the Cloudflare observation flag before the user clicks. Next.js
 * runs the server actions of a page one at a time, so a lookup sent at the
 * click would wait in front of the capture's own server action. The sign-in
 * page calls this when it mounts.
 */
export function prefetchGoogleSignupCheck(): void {
  if (!TURNSTILE_SITE_KEY || prefetchedFlag) return
  const flag = isCloudflareSignupObservationEnabled()
  prefetchedFlag = flag
  flag.catch(() => {
    if (prefetchedFlag === flag) prefetchedFlag = undefined
  })
}

function cloudflareObservationEnabled(): Promise<boolean> {
  const flag = prefetchedFlag ?? isCloudflareSignupObservationEnabled()
  prefetchedFlag = undefined
  return flag
}

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
    cloudflareObservationEnabled()
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

/**
 * The capture, or `{ unavailable: true }` once its budget runs out. The
 * capture itself keeps running: it is the shared capture of the page, and
 * `latest` gives its result if it finishes before the server call is sent.
 */
function captureWithinBudget(): {
  result: Promise<SignupFingerprintResult | undefined>
  latest: () => SignupFingerprintResult | undefined
} {
  let finished: SignupFingerprintResult | undefined
  const capture = ensureFingerprintSignupCapture()
  const result = new Promise<SignupFingerprintResult | undefined>(
    (resolve, reject) => {
      const timer = setTimeout(
        () => resolve({ unavailable: true }),
        FINGERPRINT_CAPTURE_BUDGET_MS,
      )
      capture.then(
        (value) => {
          clearTimeout(timer)
          finished = value
          resolve(value)
        },
        (error: unknown) => {
          clearTimeout(timer)
          reject(error)
        },
      )
    },
  )
  return { result, latest: () => finished }
}

async function runCheck(
  isCurrent: () => boolean,
  cancelled: AbortSignal,
  onSend: () => void,
): Promise<string | undefined> {
  // Start the capture first: its server action then leads the queue.
  const capture = captureWithinBudget()
  const recaptcha = getRecaptchaToken("signup_google")
  const turnstile = turnstileTokenWithinBudget(cancelled)
  const [budgetedCapture, recaptchaToken] = await Promise.all([
    capture.result,
    recaptcha,
  ])
  if (!isCurrent()) return undefined
  if (RECAPTCHA_SITE_KEY && !recaptchaToken) return undefined
  const turnstileToken = await turnstile
  // The last point where the check can be stopped: the server call below
  // replaces the evidence cookie and issues the proof cookie.
  if (!isCurrent()) return undefined
  // A capture that finished after its budget, while reCAPTCHA or Turnstile
  // was still running, is still the better evidence.
  const captureResult = capture.latest() ?? budgetedCapture
  const diagnostics = getFingerprintSignupDiagnostics()
  onSend()
  const proof = await beginGoogleSignup(
    recaptchaToken,
    turnstileToken,
    captureResult,
    diagnostics,
    "signin",
  )
  return proof.success ? proof.signupAttemptId : undefined
}

/**
 * Stops the running check, if any, so that it starts no further step. The
 * sign-in page calls it when it unmounts.
 */
export function cancelGoogleSignupCheck(): void {
  latestCheck++
  latestAbort?.abort()
  latestAbort = undefined
}

/**
 * Runs the Google sign-up check (fingerprint capture, the `signup_google`
 * reCAPTCHA, and the signed proof cookie) before the sign-in page sends the
 * browser to Google. The sign-in page cannot know if the Google account is
 * new, so it runs the check for every Google sign-in. A new account then has
 * its proof at the first callback and does not go to Google a second time.
 *
 * The browser steps must finish within `deadlineMs`, so a stalled reCAPTCHA or
 * Turnstile cannot hold back a returning user, and a slow capture is reported
 * as unavailable within its own budget. Once the server call is sent, the
 * check waits for its answer until `proofDeadlineMs` after the start. A call
 * that is past its deadline, or that a newer call has replaced, is cancelled:
 * it starts no further step and returns nothing. In particular it never
 * reaches the server call that replaces the evidence cookie and issues the
 * proof cookie, so a late step cannot write over the evidence of a later
 * attempt. A server call already sent when the check gives up cannot be
 * recalled, but Next.js runs a page's server actions one at a time: its
 * response, with its cookies, is applied before any later action is sent, so
 * it cannot land on top of a newer attempt. Its proof cookie is named for its
 * own attempt ID, and the callback URL does not carry that ID. Because of the
 * same queue, a later action waits for the call to finish; the call is bounded
 * by the server's own provider timeouts (reCAPTCHA, fingerprint lookup,
 * backend), so the wait is short.
 * If the capture is still running when the page leaves, its stored attempt is
 * still marked pending, and the recovery page reports that capture as
 * unavailable instead of starting a second one for the same session. That is
 * how the capture treats any reload, and the proof then follows the backend's
 * policy for missing evidence.
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
  proofDeadlineMs: number = GOOGLE_SIGNUP_PROOF_DEADLINE_MS,
): Promise<string | undefined> {
  const check = ++latestCheck
  latestAbort?.abort()
  const abort = new AbortController()
  latestAbort = abort
  const isCurrent = () => !abort.signal.aborted && check === latestCheck
  return new Promise((resolve) => {
    const giveUp = () => {
      clearTimeout(browserTimer)
      clearTimeout(proofTimer)
      abort.abort()
      resolve(undefined)
    }
    const browserTimer = setTimeout(giveUp, deadlineMs)
    const proofTimer = setTimeout(giveUp, Math.max(deadlineMs, proofDeadlineMs))
    runCheck(isCurrent, abort.signal, () => clearTimeout(browserTimer)).then(
      (attemptId) => {
        clearTimeout(browserTimer)
        clearTimeout(proofTimer)
        // A result that arrives after the check gave up is not used.
        const result = isCurrent() ? attemptId : undefined
        abort.abort()
        resolve(result)
      },
      () => giveUp(),
    )
  })
}
