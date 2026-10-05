// Supabase wraps Postgres trigger exceptions raised during auth.users INSERT
// as this generic message. The signup flow uses it only to preserve the
// existing rejected-auth response; it is not authoritative SS-499 evidence.
export const BLOCKED_TRIGGER_MESSAGE = "database error saving new user"

/**
 * Supabase exposes trigger failures through a generic Auth database error.
 * This identifies the existing rejected-auth response, but is not evidence
 * that the SS-499 abuse policy produced an authoritative block decision.
 */
export function isGenericAuthSignupFailure(message: unknown): boolean {
  return (
    typeof message === "string" &&
    message.toLowerCase().includes(BLOCKED_TRIGGER_MESSAGE)
  )
}
