import "server-only"
import crypto from "node:crypto"

import { after } from "next/server"

import type { SignupSetupBlockedError } from "@/lib/api/signup-setup-error"
import type { GoogleSignupProofFailure } from "@/lib/auth/google-signup-proof"
import { trackEvent } from "@/lib/posthog/actions"
import { AUTH_EVENTS } from "@/lib/posthog/events"

/**
 * Why the auth step of the callback could not finish. The callback sends the
 * value in the `auth_callback_failed` event and, for redirects to
 * `/auth/auth-code-error`, in its `reason` query param.
 */
export const CALLBACK_FAILURE_REASONS = [
  // Our callback got neither a `code` nor a `token_hash`, and no error.
  "missing_code",
  // No credential, but the provider or Supabase sent `error`/`error_code`
  // (for example a cancelled Google consent or an expired hosted link).
  "provider_error",
  // exchangeCodeForSession failed (OAuth or PKCE code).
  "exchange_failed",
  // verifyOtp failed for a token type other than `signup`.
  "otp_failed",
  // verifyOtp failed for a `signup` confirmation; the user goes back to
  // signup's expired-link banner, not the error page.
  "signup_link_failed",
  // The Auth trigger or the signup restriction check rejected the account.
  "signup_blocked",
  // A new Enterprise Google signup could not be placed on hold.
  "enterprise_hold_failed",
] as const

/**
 * Why the callback could not finish account setup after the user signed in.
 * Each value is the `reason` in the redirect URL: the error page's own copy
 * or retry, or signup's Google proof gate.
 */
export const CALLBACK_SETUP_FAILURE_REASONS = [
  // Enterprise pricing could not be read for an Enterprise signup.
  "pricing_unavailable",
  // The team directory could not be read, so membership is unknown.
  "membership_lookup_degraded",
  // A paid signup's first team could not be set up; the page offers a retry.
  "account_setup",
  // First-team setup was refused for one of these SignupSetupBlockedError
  // reasons.
  "account_changed",
  "impersonation",
  "team_changed",
  "team_conflict",
  // A new Google account had no valid signup proof; it returns to signup
  // with one of these GoogleSignupProofFailure reasons.
  "started_from_signin",
  "no_proof",
  "expired",
  "attempt_mismatch",
  "invalid_proof",
] as const

export type CallbackFailureReason =
  | (typeof CALLBACK_FAILURE_REASONS)[number]
  | (typeof CALLBACK_SETUP_FAILURE_REASONS)[number]

// Compile-time check: every reason these errors put in a redirect URL is a
// known event reason.
const redirectReasonsAreKnown:
  | SignupSetupBlockedError["reason"]
  | GoogleSignupProofFailure extends CallbackFailureReason
  ? true
  : never = true
void redirectReasonsAreKnown

const TOKEN_TYPES = new Set([
  "signup",
  "recovery",
  "invite",
  "magiclink",
  "email",
  "email_change",
])

// Supabase error codes are short snake_case identifiers (for example
// `otp_expired` or `flow_state_not_found`). Anything else is dropped so the
// event never carries free text.
const ERROR_CODE_PATTERN = /^[a-z0-9_]{1,64}$/

export interface CallbackFailure {
  reason: CallbackFailureReason
  method: "code" | "token_hash" | "none"
  type: string | null
  errorCode?: string | null
  userId?: string
}

/**
 * Schedules one `auth_callback_failed` event for after the response. The
 * properties carry no codes, tokens, emails, or error messages. Without a
 * known user the event uses a random distinct ID and does not create a person
 * profile. A slow or failing PostHog never delays or changes the redirect.
 */
export function trackCallbackFailure(failure: CallbackFailure): void {
  const type =
    failure.type === null
      ? null
      : TOKEN_TYPES.has(failure.type)
        ? failure.type
        : "other"
  const errorCode =
    failure.errorCode && ERROR_CODE_PATTERN.test(failure.errorCode)
      ? failure.errorCode
      : null
  const distinctId = failure.userId ?? crypto.randomUUID()
  const properties = {
    method: failure.method,
    type,
    error_code: errorCode,
    reason: failure.reason,
    ...(failure.userId ? {} : { $process_person_profile: false }),
  }
  try {
    after(async () => {
      try {
        await trackEvent(AUTH_EVENTS.CALLBACK_FAILED, distinctId, properties)
      } catch {
        /* Delivery is best effort. */
      }
    })
  } catch {
    /* No request scope: skip the event rather than fail the redirect. */
  }
}
