import "server-only"
import crypto from "node:crypto"

import { after } from "next/server"

import { trackEvent } from "@/lib/posthog/actions"
import { AUTH_EVENTS } from "@/lib/posthog/events"

/**
 * Why the auth callback could not finish. The callback puts the value in the
 * `reason` query param of `/auth/auth-code-error` (where it lands there) and
 * in the `auth_callback_failed` event. The error page shows its generic copy
 * for these values, unlike the account-setup reasons it handles by name.
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
  // The Auth trigger rejected the new account.
  "signup_blocked",
  // A new Enterprise Google signup could not be placed on hold.
  "enterprise_hold_failed",
] as const

export type CallbackFailureReason = (typeof CALLBACK_FAILURE_REASONS)[number]

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
