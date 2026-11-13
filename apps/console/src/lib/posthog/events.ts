// Centralized PostHog event constants

export const AUTH_EVENTS = {
  SIGN_IN_COMPLETED: "auth_sign_in_completed",
  SIGN_IN_FAILED: "auth_sign_in_failed",
  SIGN_IN_RECOVERY_SHOWN: "auth_sign_in_recovery_shown",
  SIGN_IN_RECOVERY_OPTION_CLICKED: "auth_sign_in_recovery_option_clicked",
  SIGN_IN_LINK_REQUESTED: "auth_sign_in_link_requested",
  SIGN_IN_LINK_SENT: "auth_sign_in_link_sent",
  SIGN_IN_LINK_FAILED: "auth_sign_in_link_failed",
  SIGN_UP_COMPLETED: "auth_sign_up_completed",
  SIGN_UP_FAILED: "auth_sign_up_failed",
  GOOGLE_SIGNUP_CAPTCHA_VERIFIED: "auth_google_signup_captcha_verified",
  GOOGLE_SIGNUP_CAPTCHA_FAILED: "auth_google_signup_captcha_failed",
  GOOGLE_SIGNUP_BYPASS_BLOCKED: "auth_google_signup_bypass_blocked",
  GOOGLE_SIGNUP_PROOF_CONSUMED: "auth_google_signup_proof_consumed",
  FINGERPRINT_SIGNUP_OBSERVED: "auth_fingerprint_signup_observed",
  SIGNUP_RESTRICTION_EVALUATED: "auth_signup_restriction_evaluated",
  CLOUDFLARE_SIGNUP_OBSERVED: "auth_cloudflare_signup_observed",
  CLOUDFLARE_SIGNUP_OBSERVATION_FAILED:
    "auth_cloudflare_signup_observation_failed",
  SIGNUP_RECAPTCHA_OBSERVED: "auth_signup_recaptcha_observed",
  SIGNUP_ATTEMPT_ASSOCIATED: "auth_signup_attempt_associated",
  SIGN_OUT: "auth_sign_out",
  PASSWORD_RESET_REQUESTED: "auth_password_reset_requested",
  PASSWORD_RESET_COMPLETED: "auth_password_reset_completed",
  DEVICE_AUTHORIZED: "cli_device_authorized",
} as const

export const SANDBOX_EVENTS = {
  CREATED: "sandbox_created",
  PAUSED: "sandbox_paused",
  RESUMED: "sandbox_resumed",
  DELETED: "sandbox_deleted",
  BULK_DELETED: "sandbox_bulk_deleted",
  CONNECT_OPENED: "sandbox_connect_opened",
  TERMINAL_OPENED: "sandbox_terminal_opened",
  PREVIEW_OPENED: "sandbox_preview_opened",
} as const

export const TERMINAL_EVENTS = {
  SESSION_STARTED: "terminal_session_started",
  SESSION_ENDED: "terminal_session_ended",
  RECONNECTED: "terminal_reconnected",
  TAB_OPENED: "terminal_tab_opened",
  TAB_CLOSED: "terminal_tab_closed",
  TAB_RENAMED: "terminal_tab_renamed",
} as const

export const FILE_EVENTS = {
  UPLOAD_SUCCEEDED: "file_upload_succeeded",
  UPLOAD_FAILED: "file_upload_failed",
  DOWNLOAD_SUCCEEDED: "file_download_succeeded",
  DOWNLOAD_FAILED: "file_download_failed",
} as const

export const API_KEY_EVENTS = {
  CREATED: "api_key_created",
  COPIED: "api_key_copied",
  REVOKED: "api_key_revoked",
  BULK_REVOKED: "api_key_bulk_revoked",
} as const

export const PLAN_PICKER_EVENTS = {
  VIEWED: "plan_picker_viewed",
} as const

// Paid Stripe Checkout funnel, sent from the server by
// src/lib/posthog/checkout.ts. Every event has `surface` (plan_picker,
// billing_pro or onboarding_plan), `offer`, `plan`, `billing_interval`,
// `checkout_session_id`, `team_id`, `region` and the PostHog `team` group.
// A value that is not known is null. Count distinct `checkout_session_id`
// values: a reload of a return page can send an event again.
//   checkout_opened: Checkout session created or resumed. Adds `price_cents`
//     (catalog list price), `reason` (the team's entry state on the plan
//     picker, for example trial_ended) and `explicit_choice` (true when the
//     customer submitted a plan on the plan picker, including a first
//     purchase; false when a link resumed Checkout or on other surfaces).
//   All three events carry the time they happened as the PostHog timestamp,
//   so a return is never ordered after its completion.
//   checkout_returned: the customer came back from Checkout. Adds `outcome`
//     (success or cancel).
//   checkout_completed: the backend confirmed the paid plan after a return.
//     Adds `price_cents` and `amount_cents` (the quoted charge, when the
//     purchase has one). This is the only checkout-level completion event;
//     `signup_plan_action` keeps its own actions on /onboarding/plan.
export const CHECKOUT_EVENTS = {
  OPENED: "checkout_opened",
  RETURNED: "checkout_returned",
  COMPLETED: "checkout_completed",
} as const

export const SNAPSHOT_EVENTS = {
  TAKEN: "snapshot_taken",
  RENAMED: "snapshot_renamed",
  DELETED: "snapshot_deleted",
} as const

export const SECRET_EVENTS = {
  CREATED: "secret_created",
  ROTATED: "secret_rotated",
  DELETED: "secret_deleted",
} as const

export const SETTINGS_EVENTS = {
  PROFILE_UPDATED: "settings_profile_updated",
  PASSWORD_CHANGED: "settings_password_changed",
  ACCOUNT_DELETION_REQUESTED: "settings_account_deletion_requested",
} as const
