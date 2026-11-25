/** Diagnostic data never participates in capture, proof, or credit decisions. */
export const diagnosticStages = [
  "capture_attempt",
  "storage_read",
  "storage_write",
  "capture",
  "cookie_write",
  "submission",
  "lookup",
  "attestation",
  "account_marker",
  "attachment",
  "identity_publication",
  "device_publication",
  "eligibility_snapshot",
] as const
export type DiagnosticStage = (typeof diagnosticStages)[number]
export type DiagnosticOutcome = "succeeded" | "rejected" | "unknown" | "skipped"
export const diagnosticReasons = [
  "completed",
  "reused_capture",
  "invalid_stored_capture",
  "storage_unavailable",
  "incomplete_capture",
  "sdk_not_registered",
  "client_unconfigured",
  "attempt_unavailable",
  "missing_event_id",
  "script_load_fail",
  "csp_block",
  "client_timeout",
  "network_connection",
  "network_abort",
  "bad_response_format",
  "sdk_error",
  "cookie_unavailable",
  "capture_present",
  "capture_unavailable",
  "capture_absent",
  "browser_diagnostics_missing",
  "server_unconfigured",
  "http_error",
  "invalid_provider_response",
  "lookup_timeout",
  "lookup_unavailable",
  "capture_pairing_missing",
  "event_mismatch",
  "challenge_mismatch",
  "invalid_timestamp",
  "verified",
  "replayed",
  "bound",
  "first_evidence_retained",
  "evidence_missing",
  "evidence_conflict",
  "invalid_evidence",
  "forbidden",
  "authority_unavailable",
  "owner",
  "owner_conflict",
  "no_attested_attempt",
  "not_original_signup",
  "original_evidence_missing",
] as const
export type DiagnosticReason = (typeof diagnosticReasons)[number]

// Fingerprint agent v4 codes are fixed labels; unknown error strings stay private.
const sdkErrorCodes = [
  "client_timeout",
  "network_connection",
  "network_abort",
  "csp_block",
  "invalid_endpoint",
  "handle_agent_data",
  "script_load_fail",
  "bad_response_format",
  "server_error",
  "api_key_missing",
  "api_key_invalid",
  "cache_misconfigured",
  "endpoints_misconfigured",
  "wrong_worker_option",
  "worker_initialization_failed",
  "sandboxed_iframe",
  "bundle_not_defined",
  "request_cannot_be_parsed",
  "request_read_timeout",
  "secret_api_key_required",
  "secret_api_key_not_found",
  "public_api_key_required",
  "public_api_key_not_found",
  "subscription_not_active",
  "wrong_region",
  "feature_not_enabled",
  "request_not_found",
  "visitor_not_found",
  "too_many_requests",
  "state_not_ready",
  "failed",
  "event_not_found",
  "missing_module",
  "payload_too_large",
] as const
type SdkErrorCode = (typeof sdkErrorCodes)[number]
const sdkErrorTypes = [
  "FingerprintError",
  "Error",
  "TypeError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "URIError",
  "EvalError",
  "DOMException",
  "unknown",
] as const
type SdkErrorType = (typeof sdkErrorTypes)[number]

export interface FingerprintDiagnostic {
  stage: DiagnosticStage
  outcome: DiagnosticOutcome
  reason: DiagnosticReason
  occurred_at: string
  elapsed_ms?: number
  capture_attempt_id?: string
  provider_event_id?: string
  http_status?: number
  sdk_error_code?: SdkErrorCode
  sdk_error_type?: SdkErrorType
}
export interface BrowserFingerprintDiagnostics {
  schema_version: 1
  events: FingerprintDiagnostic[]
}

export function diagnosticId(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-zA-Z0-9._-]{1,128}$/.test(value)
    ? value
    : undefined
}

/** Copy only known fields; never forward raw exceptions, proofs, or payloads. */
export function sanitizeDiagnostic(
  value: unknown,
): FingerprintDiagnostic | undefined {
  if (!value || typeof value !== "object") return undefined
  const row = value as Record<string, unknown>
  if (
    !diagnosticStages.includes(row.stage as DiagnosticStage) ||
    !["succeeded", "rejected", "unknown", "skipped"].includes(
      row.outcome as string,
    ) ||
    !diagnosticReasons.includes(row.reason as DiagnosticReason) ||
    typeof row.occurred_at !== "string" ||
    row.occurred_at.length > 32 ||
    !Number.isFinite(Date.parse(row.occurred_at))
  )
    return undefined
  return {
    stage: row.stage as DiagnosticStage,
    outcome: row.outcome as DiagnosticOutcome,
    reason: row.reason as DiagnosticReason,
    occurred_at: row.occurred_at,
    ...(typeof row.elapsed_ms === "number" &&
    Number.isFinite(row.elapsed_ms) &&
    row.elapsed_ms >= 0
      ? { elapsed_ms: Math.min(row.elapsed_ms, 600_000) }
      : {}),
    capture_attempt_id: diagnosticId(row.capture_attempt_id),
    provider_event_id: diagnosticId(row.provider_event_id),
    ...(row.stage === "capture" && row.outcome === "unknown"
      ? {
          ...(isSdkErrorCode(row.sdk_error_code)
            ? { sdk_error_code: row.sdk_error_code }
            : {}),
          ...(isSdkErrorType(row.sdk_error_type)
            ? { sdk_error_type: row.sdk_error_type }
            : {}),
        }
      : {}),
    ...(typeof row.http_status === "number" &&
    Number.isInteger(row.http_status) &&
    row.http_status >= 100 &&
    row.http_status <= 599
      ? { http_status: row.http_status }
      : {}),
  }
}

function isSdkErrorCode(value: unknown): value is SdkErrorCode {
  return (
    typeof value === "string" && sdkErrorCodes.includes(value as SdkErrorCode)
  )
}

function isSdkErrorType(value: unknown): value is SdkErrorType {
  return (
    typeof value === "string" && sdkErrorTypes.includes(value as SdkErrorType)
  )
}

function errorField(error: unknown, field: "code" | "name"): unknown {
  try {
    return error && typeof error === "object"
      ? (error as Record<string, unknown>)[field]
      : undefined
  } catch {
    return undefined
  }
}

export function sdkDiagnosticDetails(
  error: unknown,
): Pick<FingerprintDiagnostic, "sdk_error_code" | "sdk_error_type"> {
  const code = errorField(error, "code")
  const name = errorField(error, "name")
  let type: SdkErrorType = isSdkErrorType(name) ? name : "unknown"
  try {
    if (typeof DOMException !== "undefined" && error instanceof DOMException)
      type = "DOMException"
  } catch {
    /* An unreadable exception must not affect capture state. */
  }
  return {
    ...(isSdkErrorCode(code) ? { sdk_error_code: code } : {}),
    sdk_error_type: type,
  }
}

export function sdkDiagnosticReason(error: unknown): DiagnosticReason {
  const code = errorField(error, "code")
  return typeof code === "string" &&
    [
      "script_load_fail",
      "csp_block",
      "client_timeout",
      "network_connection",
      "network_abort",
      "bad_response_format",
    ].includes(code)
    ? (code as DiagnosticReason)
    : "sdk_error"
}
