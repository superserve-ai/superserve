import { beginGoogleSignup } from "@/app/(auth)/auth/signup/action"
import {
  ensureFingerprintSignupCapture,
  getFingerprintSignupDiagnostics,
} from "@/lib/fingerprint/client"
import { RECAPTCHA_SITE_KEY, getRecaptchaToken } from "@/lib/recaptcha/client"

/**
 * Runs the Google sign-up check (fingerprint capture, the `signup_google`
 * reCAPTCHA, and the signed proof cookie) before the sign-in page sends the
 * browser to Google. The sign-in page cannot know if the Google account is
 * new, so it runs the check for every Google sign-in. A new account then has
 * its proof at the first callback and does not go to Google a second time.
 *
 * The check runs to the end, as on the sign-up page, and has no time limit of
 * its own. A check left running after the page goes to Google could replace
 * the evidence of a later attempt or leave a fingerprint capture half done
 * for the recovery page. reCAPTCHA already stops waiting after its own limits.
 *
 * Returns the sign-up attempt ID for the callback URL, or undefined when the
 * check fails. Sign-in continues either way: an existing account does not
 * need the proof, and a new account without one still goes to the recovery
 * page, where the same check runs again.
 */
export async function googleSignupAttemptForSignIn(): Promise<
  string | undefined
> {
  try {
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
  } catch {
    return undefined
  }
}
