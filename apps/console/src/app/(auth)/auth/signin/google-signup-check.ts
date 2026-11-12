import { beginGoogleSignup } from "@/app/(auth)/auth/signup/action"
import {
  ensureFingerprintSignupCapture,
  getFingerprintSignupDiagnostics,
} from "@/lib/fingerprint/client"
import { RECAPTCHA_SITE_KEY, getRecaptchaToken } from "@/lib/recaptcha/client"

// An existing user should not wait long for a check only a new account needs.
// A check that does not finish in time leaves the callback's recovery page as
// the way to finish a new account.
export const SIGN_IN_SIGNUP_CHECK_TIMEOUT_MS = 5000

/**
 * Runs the Google sign-up check (fingerprint capture, the `signup_google`
 * reCAPTCHA, and the signed proof cookie) before the sign-in page sends the
 * browser to Google. The sign-in page cannot know if the Google account is
 * new, so it runs the check for every Google sign-in. A new account then has
 * its proof at the first callback and does not go to Google a second time.
 *
 * Returns the sign-up attempt ID for the callback URL, or undefined when the
 * check fails or times out. Sign-in continues either way: an existing account
 * does not need the proof, and a new account without one still goes to the
 * recovery page, where the same check runs again.
 */
export async function googleSignupAttemptForSignIn(
  timeoutMs = SIGN_IN_SIGNUP_CHECK_TIMEOUT_MS,
): Promise<string | undefined> {
  const check = (async () => {
    const capture = await ensureFingerprintSignupCapture()
    const diagnostics = getFingerprintSignupDiagnostics()
    const recaptchaToken = await getRecaptchaToken("signup_google")
    if (RECAPTCHA_SITE_KEY && !recaptchaToken) return undefined
    const proof = await beginGoogleSignup(
      recaptchaToken,
      undefined,
      capture,
      diagnostics,
      "signin",
    )
    return proof.success ? proof.signupAttemptId : undefined
  })().catch(() => undefined)
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), timeoutMs)
  })
  try {
    return await Promise.race([check, timeout])
  } finally {
    clearTimeout(timer)
  }
}
