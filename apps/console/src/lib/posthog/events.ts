// Centralized PostHog event constants

export const AUTH_EVENTS = {
  SIGN_IN_COMPLETED: "auth_sign_in_completed",
  SIGN_IN_FAILED: "auth_sign_in_failed",
  SIGN_UP_COMPLETED: "auth_sign_up_completed",
  SIGN_UP_FAILED: "auth_sign_up_failed",
  SIGN_OUT: "auth_sign_out",
  DEVICE_AUTHORIZED: "cli_device_authorized",
} as const

export const ONBOARDING_EVENTS = {
  STEP_COMPLETED: "onboarding_step_completed",
  FRAMEWORK_SELECTED: "onboarding_framework_selected",
  AGENT_PATH_SELECTED: "onboarding_agent_path_selected",
  PLAYGROUND_OPENED: "playground_agent_opened",
} as const

export const SANDBOX_EVENTS = {
  CREATED: "sandbox_created",
  STARTED: "sandbox_started",
  STOPPED: "sandbox_stopped",
  DELETED: "sandbox_deleted",
  BULK_DELETED: "sandbox_bulk_deleted",
} as const

export const TERMINAL_EVENTS = {
  SESSION_STARTED: "terminal_session_started",
  SESSION_ENDED: "terminal_session_ended",
  RECONNECTED: "terminal_reconnected",
} as const

export const API_KEY_EVENTS = {
  CREATED: "api_key_created",
  COPIED: "api_key_copied",
  REVOKED: "api_key_revoked",
  BULK_REVOKED: "api_key_bulk_revoked",
} as const

export const SNAPSHOT_EVENTS = {
  DELETED: "snapshot_deleted",
  BULK_DELETED: "snapshot_bulk_deleted",
} as const

export const SETTINGS_EVENTS = {
  PROFILE_UPDATED: "settings_profile_updated",
  PASSWORD_CHANGED: "settings_password_changed",
  ACCOUNT_DELETION_REQUESTED: "settings_account_deletion_requested",
} as const
