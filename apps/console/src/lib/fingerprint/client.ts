import { createSignupFingerprintAttempt } from "@/app/(auth)/auth/signup/action"

import { FINGERPRINT_SIGNUP_COOKIE } from "./constants"

const FINGERPRINT_SIGNUP_COOKIE_MAX_AGE_SECONDS = 600
const CAPTURE_KEY = "superserve_signup_fingerprint_capture"
export interface SignupFingerprintCapture {
  attemptId: string
  challenge: string
  eventId: string
}
type FingerprintGetData = (options?: {
  tag: { signup_challenge: string }
}) => Promise<{ event_id?: string }>
let fingerprintGetData: FingerprintGetData | undefined
let capturePromise: Promise<SignupFingerprintCapture | undefined> | undefined
let completedCapture: SignupFingerprintCapture | undefined
let captureStarted = false

export function registerFingerprintGetData(getData: FingerprintGetData) {
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
  SignupFingerprintCapture | undefined
> {
  if (typeof window === "undefined") return Promise.resolve(undefined)
  const existing = completedCapture ?? storedCapture()
  if (existing) return Promise.resolve(existing)
  if (capturePromise) return capturePromise
  // A reload or rejected provider response cannot prove capture did not occur.
  // Keep that attempt instead of creating a different event for its challenge.
  if (captureStarted || pendingAttempt()) return Promise.resolve(undefined)
  if (!fingerprintGetData) return Promise.resolve(undefined)
  capturePromise = (async () => {
    const attempt = {
      ...(await createSignupFingerprintAttempt()),
      startedAt: Date.now(),
    }
    sessionStorage.setItem(CAPTURE_KEY, JSON.stringify(attempt))
    captureStarted = true
    const result = await fingerprintGetData!({
      tag: { signup_challenge: attempt.challenge },
    })
    if (!result.event_id) return undefined
    const capture = {
      attemptId: attempt.attemptId,
      challenge: attempt.challenge,
      eventId: result.event_id,
    }
    completedCapture = capture
    sessionStorage.setItem(CAPTURE_KEY, JSON.stringify(capture))
    writeFingerprintSignupEventIdCookie(result.event_id)
    return capture
  })()
    .catch(() => undefined)
    .finally(() => {
      capturePromise = undefined
    })
  return capturePromise
}

export function ensureFingerprintSignupEventId(): Promise<string | undefined> {
  return ensureFingerprintSignupCapture().then((capture) => capture?.eventId)
}

export function clearFingerprintSignupCapture(): void {
  // Submission clears only a completed capture, never an in-flight pairing.
  if (capturePromise) return
  completedCapture = undefined
  captureStarted = false
  try {
    sessionStorage.removeItem(CAPTURE_KEY)
  } catch {
    // Session storage is only transport for the next signup.
  }
}
