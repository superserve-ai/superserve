import { createSignupFingerprintAttempt } from "@/app/(auth)/auth/signup/action"

import { FINGERPRINT_SIGNUP_COOKIE } from "./constants"
import {
  sanitizeDiagnostic,
  sdkDiagnosticReason,
  type BrowserFingerprintDiagnostics,
  type FingerprintDiagnostic,
  type DiagnosticStage,
} from "./diagnostics"

const FINGERPRINT_SIGNUP_COOKIE_MAX_AGE_SECONDS = 600
const CAPTURE_KEY = "superserve_signup_fingerprint_capture"
export interface SignupFingerprintCapture {
  attemptId: string
  challenge: string
  eventId: string
}
export type SignupFingerprintResult =
  | SignupFingerprintCapture
  | { unavailable: true }

type FingerprintGetData = (options?: {
  tag: { signup_challenge: string }
}) => Promise<{ event_id?: string }>
let fingerprintGetData: FingerprintGetData | undefined
let capturePromise: Promise<SignupFingerprintResult | undefined> | undefined
let completedCapture: SignupFingerprintCapture | undefined
let captureStarted = false
let activeCaptureAttemptId: string | undefined
let diagnostics: BrowserFingerprintDiagnostics = {
  schema_version: 1,
  events: [],
}

export function getFingerprintSignupDiagnostics(): BrowserFingerprintDiagnostics {
  return {
    schema_version: 1,
    events: diagnostics.events.map((event) => ({ ...event })),
  }
}

function recordDiagnostic(event: Omit<FingerprintDiagnostic, "occurred_at">) {
  try {
    const row = sanitizeDiagnostic({
      ...event,
      occurred_at: new Date().toISOString(),
    })
    if (row && diagnostics.events.length < 8) diagnostics.events.push(row)
  } catch {
    /* Diagnostics never change capture state. */
  }
}

export function registerFingerprintGetData(getData?: FingerprintGetData) {
  fingerprintGetData = getData
}

function storedCapture(): SignupFingerprintCapture | undefined {
  try {
    const raw = sessionStorage.getItem(CAPTURE_KEY)
    if (!raw) return undefined
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== "object") return undefined
    const capture = value as Record<string, unknown>
    if (
      typeof capture.attemptId !== "string" ||
      typeof capture.challenge !== "string" ||
      typeof capture.eventId !== "string"
    )
      return undefined
    return capture as unknown as SignupFingerprintCapture
  } catch {
    return undefined
  }
}

function pendingAttempt():
  | { attemptId: string; challenge: string; startedAt: number }
  | undefined {
  try {
    const raw = sessionStorage.getItem(CAPTURE_KEY)
    if (!raw) return undefined
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== "object") return undefined
    const attempt = value as Record<string, unknown>
    if (
      typeof attempt.attemptId !== "string" ||
      typeof attempt.challenge !== "string" ||
      typeof attempt.startedAt !== "number"
    )
      return undefined
    return {
      attemptId: attempt.attemptId,
      challenge: attempt.challenge,
      startedAt: attempt.startedAt,
    }
  } catch {
    return undefined
  }
}

export function readFingerprintSignupEventIdCookie(): string | undefined {
  if (typeof document === "undefined") return undefined
  const cookie = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(`${FINGERPRINT_SIGNUP_COOKIE}=`))
  if (!cookie) return undefined
  try {
    return decodeURIComponent(
      cookie.slice(FINGERPRINT_SIGNUP_COOKIE.length + 1),
    )
  } catch {
    return undefined
  }
}

export function writeFingerprintSignupEventIdCookie(eventId: string) {
  if (typeof window === "undefined") return
  const secure = window.location.protocol === "https:" ? "; Secure" : ""
  document.cookie = `${FINGERPRINT_SIGNUP_COOKIE}=${encodeURIComponent(eventId)}; Path=/; Max-Age=${FINGERPRINT_SIGNUP_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax${secure}`
}

/** The captured event keeps its original server attempt through form retries. */
export function ensureFingerprintSignupCapture(): Promise<
  SignupFingerprintResult | undefined
> {
  if (typeof window === "undefined") return Promise.resolve(undefined)
  try {
    if (
      sessionStorage.getItem(CAPTURE_KEY) &&
      !storedCapture() &&
      !pendingAttempt()
    ) {
      recordDiagnostic({
        stage: "storage_read",
        outcome: "rejected",
        reason: "invalid_stored_capture",
      })
      return Promise.resolve({ unavailable: true })
    }
  } catch {
    recordDiagnostic({
      stage: "storage_read",
      outcome: "unknown",
      reason: "storage_unavailable",
    })
    return Promise.resolve({ unavailable: true })
  }
  const existing = completedCapture ?? storedCapture()
  if (existing) {
    recordDiagnostic({
      stage: "capture",
      outcome: "succeeded",
      reason: "reused_capture",
      capture_attempt_id: existing.attemptId,
      provider_event_id: existing.eventId,
    })
    return Promise.resolve(existing)
  }
  if (capturePromise) return capturePromise
  // A reload or rejected provider response cannot prove capture did not occur.
  // Keep that attempt instead of creating a different event for its challenge.
  const pending = captureStarted ? undefined : pendingAttempt()
  if (captureStarted || pending) {
    recordDiagnostic({
      stage: "capture",
      outcome: "unknown",
      reason: "incomplete_capture",
      capture_attempt_id: pending?.attemptId ?? activeCaptureAttemptId,
    })
    return Promise.resolve({ unavailable: true })
  }
  if (!fingerprintGetData) {
    recordDiagnostic({
      stage: "capture",
      outcome: "skipped",
      reason: process.env.NEXT_PUBLIC_FINGERPRINT_API_KEY
        ? "sdk_not_registered"
        : "client_unconfigured",
    })
    return Promise.resolve(undefined)
  }
  // Keep the first failure while this capture is retained across form retries.
  diagnostics = { schema_version: 1, events: [] }
  const startedAt = Date.now()
  let stage: DiagnosticStage = "capture_attempt"
  let attemptId: string | undefined
  let eventId: string | undefined
  capturePromise = (async () => {
    const attempt = {
      ...(await createSignupFingerprintAttempt()),
      startedAt: Date.now(),
    }
    attemptId = attempt.attemptId
    activeCaptureAttemptId = attemptId
    recordDiagnostic({
      stage,
      outcome: "succeeded",
      reason: "completed",
      capture_attempt_id: attemptId,
    })
    stage = "storage_write"
    sessionStorage.setItem(CAPTURE_KEY, JSON.stringify(attempt))
    stage = "capture"
    captureStarted = true
    const result = await fingerprintGetData!({
      tag: { signup_challenge: attempt.challenge },
    })
    if (!result.event_id) {
      recordDiagnostic({
        stage,
        outcome: "unknown",
        reason: "missing_event_id",
        capture_attempt_id: attemptId,
        elapsed_ms: Date.now() - startedAt,
      })
      return { unavailable: true as const }
    }
    eventId = result.event_id
    recordDiagnostic({
      stage,
      outcome: "succeeded",
      reason: "completed",
      capture_attempt_id: attemptId,
      provider_event_id: eventId,
      elapsed_ms: Date.now() - startedAt,
    })
    const capture = {
      attemptId: attempt.attemptId,
      challenge: attempt.challenge,
      eventId: result.event_id,
    }
    completedCapture = capture
    stage = "storage_write"
    sessionStorage.setItem(CAPTURE_KEY, JSON.stringify(capture))
    stage = "cookie_write"
    writeFingerprintSignupEventIdCookie(result.event_id)
    return capture
  })()
    .catch((error) => {
      recordDiagnostic({
        stage,
        outcome: "unknown",
        reason:
          stage === "capture"
            ? sdkDiagnosticReason(error)
            : stage === "capture_attempt"
              ? "attempt_unavailable"
              : stage === "cookie_write"
                ? "cookie_unavailable"
                : "storage_unavailable",
        capture_attempt_id: attemptId,
        provider_event_id: eventId,
        elapsed_ms: Date.now() - startedAt,
      })
      return { unavailable: true as const }
    })
    .finally(() => {
      capturePromise = undefined
    })
  return capturePromise
}

export function ensureFingerprintSignupEventId(): Promise<string | undefined> {
  return ensureFingerprintSignupCapture().then((capture) =>
    capture && "eventId" in capture ? capture.eventId : undefined,
  )
}

export function clearFingerprintSignupCapture(): void {
  // Submission clears only a completed capture, never an in-flight pairing.
  if (capturePromise) return
  completedCapture = undefined
  captureStarted = false
  activeCaptureAttemptId = undefined
  diagnostics = { schema_version: 1, events: [] }
  try {
    sessionStorage.removeItem(CAPTURE_KEY)
  } catch {
    // Session storage is only transport for the next signup.
  }
}
