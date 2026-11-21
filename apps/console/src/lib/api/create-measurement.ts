// Correlation is untrusted telemetry metadata, never an authorization or retry key.
export function correlationId(value: unknown): string | null {
  return typeof value === "string" &&
    value.length === 36 &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
    ? value
    : null
}

export function createdSandboxUuid(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 57) return null
  // Match the public ID convention without importing data-plane URL config.
  const publicId = /^sb-[a-z0-9]{1,17}-([0-9a-f-]{36})$/i.exec(value)
  return correlationId(publicId?.[0] === value ? publicId[1] : value)
}

const safeCodes = new Set([
  "trial_exhausted",
  "trial_unavailable",
  "trial_check_unavailable",
  "billing_ineligible",
  "free_allowance_exhausted",
  "sandbox_exceeds_plan_limits",
  "validation_failed",
  "other",
  "unknown",
])

export function createErrorCode(value: unknown): string {
  if (value == null || value === "unknown_error") return "unknown"
  return typeof value === "string" && safeCodes.has(value) ? value : "other"
}

export interface CreateClientResult {
  outcome:
    | "validation_rejected"
    | "http_success"
    | "http_error"
    | "transport_unknown"
    | "response_decode_unknown"
  request_dispatched: boolean
  request_id: string | null
  http_status: number | null
  error_code: string | null
  sandbox_id: string | null
}

export interface CreateMeasurement {
  attemptId: string | null
  onResult: (result: CreateClientResult) => void
}
