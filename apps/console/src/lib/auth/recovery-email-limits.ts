import "server-only"
import { type AuthRateLimit, consumeAuthRateLimit } from "@/lib/auth/rate-limit"

// The password reset and sign-in link actions create recovery tokens with the
// admin generateLink API and send the email themselves. That path skips the
// limits Supabase Auth applies to its own /recover endpoint, so these limits
// copy Auth's defaults: one email per address per minute (SMTP max frequency)
// and 30 emails per hour for the project (rate limit for emails sent).

// One bucket for both actions: every recovery token replaces the previous one,
// so a second request inside the minute would break the link just sent.
const RECOVERY_EMAIL_COOLDOWN: AuthRateLimit = {
  bucket: "recovery_email_cooldown",
  max: 1,
  windowSeconds: 60,
}

const DEFAULT_RECOVERY_EMAILS_PER_HOUR = 30
const MAX_RECOVERY_EMAILS_PER_HOUR = 100_000
const PROJECT_KEY = "project"
const BUSY_RETRY_MS = 50

export function recoveryEmailHourlyLimit(): AuthRateLimit {
  const raw = process.env.AUTH_RECOVERY_EMAILS_PER_HOUR?.trim()
  const parsed = raw && /^\d+$/.test(raw) ? Number(raw) : NaN
  const max =
    parsed >= 1 && parsed <= MAX_RECOVERY_EMAILS_PER_HOUR
      ? parsed
      : DEFAULT_RECOVERY_EMAILS_PER_HOUR
  return { bucket: "recovery_email_project", max, windowSeconds: 60 * 60 }
}

/**
 * Starts the per-address cooldown. Returns false when this address already
 * got a recovery token in the last minute. Call it before generateLink, so a
 * refused request does not replace the token in the email already sent.
 */
export function startRecoveryEmailCooldown(email: string): Promise<boolean> {
  return consumeAuthRateLimit(RECOVERY_EMAIL_COOLDOWN, email.toLowerCase())
}

/**
 * Takes one email from the project-wide hourly budget. Call it only right
 * before an email is sent, so requests for addresses with no account do not
 * use the budget and cannot block resets for everyone else.
 */
export async function reserveRecoveryEmail(): Promise<boolean> {
  const limit = recoveryEmailHourlyLimit()
  if (await consumeAuthRateLimit(limit, PROJECT_KEY)) return true
  // The store refuses a call that finds the key locked by a concurrent call.
  // Every send uses this one key, so try once more before dropping the email.
  await new Promise((resolve) => setTimeout(resolve, BUSY_RETRY_MS))
  if (await consumeAuthRateLimit(limit, PROJECT_KEY)) return true
  console.error("Recovery email hourly budget used up:", limit.max)
  return false
}
