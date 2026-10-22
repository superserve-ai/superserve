import "server-only"
import { randomUUID } from "node:crypto"

import { after } from "next/server"

import { PromotionEvidenceError } from "@/lib/api/promotion-device-evidence"
import { trackEventBatch } from "@/lib/posthog/batch"

import {
  diagnosticId,
  sanitizeDiagnostic,
  type FingerprintDiagnostic,
} from "./diagnostics"

interface DiagnosticContext {
  signupAttemptId?: string
  captureAttemptId?: string
  eventId?: string
  userId?: string | null
  signupMethod?: "email" | "google"
}

/** One bounded, post-response batch per boundary; delivery cannot affect signup. */
export function fingerprintDiagnostics(context: DiagnosticContext) {
  const events: Record<string, unknown>[] = []
  let scheduled = false
  let runId: string | undefined
  const record = (
    value: Omit<FingerprintDiagnostic, "occurred_at"> & {
      occurred_at?: string
    },
    source: "server" | "client_reported" = "server",
  ) => {
    try {
      if (events.length >= 12) return
      const row = sanitizeDiagnostic({
        ...value,
        occurred_at: value.occurred_at ?? new Date().toISOString(),
      })
      if (!row) return
      runId ??= randomUUID()
      events.push({
        ...row,
        schema_version: 1,
        source,
        diagnostic_run_id: runId,
        signup_attempt_id: diagnosticId(context.signupAttemptId),
        // IDs are links, not identity assertions; only the authenticated caller supplies userId.
        superserve_user_id: diagnosticId(context.userId),
        capture_attempt_id:
          row.capture_attempt_id ??
          (source === "server"
            ? diagnosticId(context.captureAttemptId)
            : undefined),
        provider_event_id:
          row.provider_event_id ??
          (source === "server" ? diagnosticId(context.eventId) : undefined),
        signup_method: context.signupMethod,
      })
      if (scheduled) return
      scheduled = true
      after(async () => {
        try {
          console.info("Fingerprint signup diagnostics", { events })
          await trackEventBatch(
            events.map((properties) => ({
              event: `auth_fingerprint_signup_${properties.stage}`,
              // Never identify an analytics person using a client-supplied correlation ID.
              distinctId: runId!,
              properties: { ...properties, $process_person_profile: false },
            })),
          )
        } catch {
          /* Delivery is best effort. */
        }
      })
    } catch {
      /* Diagnostics cannot affect signup. */
    }
  }
  return {
    record,
    browser(value: unknown) {
      try {
        const report = value as { schema_version?: unknown; events?: unknown }
        if (report?.schema_version !== 1 || !Array.isArray(report.events)) {
          record({
            stage: "submission",
            outcome: "unknown",
            reason: "browser_diagnostics_missing",
          })
          return
        }
        const browserStages = new Set([
          "capture_attempt",
          "storage_read",
          "storage_write",
          "capture",
          "cookie_write",
        ])
        for (const candidate of report.events.slice(0, 8)) {
          const row = sanitizeDiagnostic(candidate)
          if (row && browserStages.has(row.stage))
            record(row, "client_reported")
        }
      } catch {
        /* Untrusted diagnostics are optional. */
      }
    },
  }
}

export function promotionDiagnosticFailure(
  error: unknown,
): Pick<FingerprintDiagnostic, "outcome" | "reason" | "http_status"> {
  if (
    error instanceof PromotionEvidenceError &&
    [
      "evidence_missing",
      "evidence_conflict",
      "invalid_evidence",
      "forbidden",
    ].includes(error.code)
  ) {
    return {
      outcome: "rejected",
      reason: error.code as
        | "evidence_missing"
        | "evidence_conflict"
        | "invalid_evidence"
        | "forbidden",
      http_status: error.status,
    }
  }
  return { outcome: "unknown", reason: "authority_unavailable" }
}
