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

function turnstileTokenWithinBudget(): Promise<string | undefined> {
  if (!TURNSTILE_SITE_KEY) return Promise.resolve(undefined)
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), TURNSTILE_BUDGET_MS)
    isCloudflareSignupObservationEnabled()
      .then((enabled) => (enabled ? getTurnstileToken() : undefined))
      .catch(() => undefined)
      .then((token) => {
        clearTimeout(timer)
        resolve(token)
      })
  })
}

async function runCheck(isCurrent: () => boolean): Promise<string | undefined> {
  const turnstile = turnstileTokenWithinBudget()
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
 * already sent when the deadline passes cannot be recalled; its proof cookie
 * is named for its own attempt ID and the callback URL does not carry that ID.
 * A fingerprint capture left running is the shared capture of the page, which
 * the next attempt, or the recovery page, reuses.
 *
 * Returns the sign-up attempt ID for the callback URL, or undefined when the
 * check fails or runs out of time. Sign-in continues either way.
 */
export function googleSignupAttemptForSignIn(
  deadlineMs: number = GOOGLE_SIGNUP_CHECK_DEADLINE_MS,
): Promise<string | undefined> {
  const check = ++latestCheck
  let expired = false
  const isCurrent = () => !expired && check === latestCheck
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      expired = true
      resolve(undefined)
    }, deadlineMs)
    runCheck(isCurrent).then(
      (attemptId) => {
        clearTimeout(timer)
        // A result that arrives after the deadline is not used.
        resolve(isCurrent() ? attemptId : undefined)
      },
      () => {
        clearTimeout(timer)
        resolve(undefined)
      },
    )
  })
}
