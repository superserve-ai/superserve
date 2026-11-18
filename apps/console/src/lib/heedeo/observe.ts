// Heedeo sign-up observation (observe-only). At sign-up the console sends one
// `signup` event to Heedeo (`POST /v1/evaluations`) after the response is
// out, and records Heedeo's answer in PostHog (`auth_heedeo_signup_observed`)
// and in a structured log line. Nothing here decides anything: no credit,
// trial, restriction or authentication path reads the result, and every
// failure ends in a recorded outcome, never in an error for the user.

import crypto from "node:crypto"

import { cookies, headers as requestHeaders } from "next/headers"
import { after } from "next/server"

import { trackEvent } from "@/lib/posthog/actions"
import { AUTH_EVENTS } from "@/lib/posthog/events"

import { heedeoObservationEnabled, heedeoSecretKey } from "./config"
import { HEEDEO_UPSTREAM, readCapped, trustedClientIp } from "./proxy"
import {
  decodeHeedeoCapture,
  HEEDEO_SIGNUP_COOKIE,
  HEEDEO_SIGNUP_COOKIE_PATH,
  type HeedeoCapture,
} from "./shared"

export const HEEDEO_API_VERSION = "2026-11-08"
export const HEEDEO_EVALUATION_BUDGET_MS = 3000
// An evaluation answer is a few KB; anything far larger is not one.
export const HEEDEO_EVALUATION_RESPONSE_MAX = 256 * 1024

// The end user's request headers Heedeo reads, as `@heedeo/sdk` sends them.
// Never cookie or authorization.
const EVENT_HEADERS = [
  "user-agent",
  "accept",
  "accept-language",
  "sec-fetch-site",
  "sec-fetch-mode",
  "sec-fetch-dest",
  "upgrade",
  "signature",
  "signature-input",
  "signature-agent",
  "content-digest",
  "sec-ch-ua",
  "sec-ch-ua-platform",
  "sec-ch-ua-mobile",
  "cf-ipcountry",
  "x-vercel-ip-country",
] as const

// The documented top-level fields of an evaluation (docs.heedeo.com,
// section 4, and https://app.heedeo.com/docs/api.json). Anything else in a
// response is dropped rather than copied into analytics.
const ANSWER_FIELDS = [
  "flagged",
  "no_token",
  "flag",
  "score",
  "threshold",
  "thresholds",
  "suggested",
  "decision",
  "risks",
  "version",
  "reasons",
  "visitor",
  "related",
  "account",
  "counts",
  "activity",
  "listed",
  "email",
  "network",
  "agent",
  "environment",
  "event_id",
] as const

export type HeedeoRequestContext = {
  clientIp: string | null
  headers: Record<string, string>
}

export type HeedeoSignupObservation = {
  signupAttemptId: string | undefined
  signupMethod: "email" | "google"
  email: string | null
  userId: string | null
  /** `succeeded` when this attempt created the account. */
  status: "succeeded" | "failed"
  /** The browser's capture, or null when the browser sent none. */
  capture: HeedeoCapture | null
  request: HeedeoRequestContext | null
  /** Google's `email_verified`, sent as Heedeo `evidence.oauth`. */
  oauthEmailVerified?: boolean
}

type Outcome = {
  outcome: string
  httpStatus: number | null
  errorCode: string | null
  traceId: string | null
  attempts: number
  answer: Record<string, unknown> | null
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const str = (value: unknown, max = 200): string | null =>
  typeof value === "string" && value.length > 0 ? value.slice(0, max) : null

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null

const bool = (value: unknown): boolean | null =>
  typeof value === "boolean" ? value : null

export function isHeedeoObservationEnabled(): boolean {
  try {
    return heedeoObservationEnabled()
  } catch {
    return false
  }
}

/** What the observation needs from the incoming request, read up front. */
export function heedeoRequestContext(
  incoming: Headers,
  method: string,
  path: string,
): HeedeoRequestContext {
  const forwarded: Record<string, string> = {
    ":method": method,
    ":path": path,
    ":forwarded": EVENT_HEADERS.join(","),
  }
  const host = incoming.get("host")
  if (host && /^(?:[a-z0-9.-]+|\[[0-9a-f:.]+\])(?::\d{1,5})?$/i.test(host))
    forwarded.host = host
  for (const name of EVENT_HEADERS) {
    const value = incoming.get(name)
    if (value !== null) forwarded[name] = value.slice(0, 1024)
  }
  return { clientIp: trustedClientIp(incoming), headers: forwarded }
}

/** `heedeoRequestContext` for the current server action, or null. */
export async function readHeedeoRequestContext(
  path: string,
): Promise<HeedeoRequestContext | null> {
  try {
    return heedeoRequestContext(await requestHeaders(), "POST", path)
  } catch {
    return null
  }
}

/**
 * Reads and deletes the browser's capture, so a token is sent with one event
 * only. Null when there is none or it is not one the browser wrote.
 */
export async function takeHeedeoSignupCapture(): Promise<HeedeoCapture | null> {
  try {
    const store = await cookies()
    const raw = store.get(HEEDEO_SIGNUP_COOKIE)?.value
    if (raw === undefined) return null
    try {
      store.delete({
        name: HEEDEO_SIGNUP_COOKIE,
        path: HEEDEO_SIGNUP_COOKIE_PATH,
      })
    } catch {
      // A read-only cookie store still lets the observation run.
    }
    return decodeHeedeoCapture(raw)
  } catch {
    return null
  }
}

// Reads at most `HEEDEO_EVALUATION_RESPONSE_MAX` bytes. A larger or invalid
// body throws a SyntaxError, which the caller reports as `malformed`.
async function readJson(
  response: Response,
  signal: AbortSignal,
): Promise<unknown> {
  const bytes = await readCapped(
    response.body,
    HEEDEO_EVALUATION_RESPONSE_MAX,
    signal,
  )
  if (!bytes) throw new SyntaxError("Heedeo response too large")
  return JSON.parse(new TextDecoder().decode(bytes))
}

async function evaluate(
  secretKey: string,
  body: string,
  fetchImpl: typeof fetch,
): Promise<Outcome> {
  const signal = AbortSignal.timeout(HEEDEO_EVALUATION_BUDGET_MS)
  let last: Outcome = {
    outcome: "error",
    httpStatus: null,
    errorCode: null,
    traceId: null,
    attempts: 0,
    answer: null,
  }
  // One retry within the same budget, as `@heedeo/sdk` does, and only for a
  // 5xx or a network error: a 4xx is a mistake in the call.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await fetchImpl(`${HEEDEO_UPSTREAM}/v1/evaluations`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${secretKey}`,
          "content-type": "application/json",
          "heedeo-version": HEEDEO_API_VERSION,
        },
        body,
        redirect: "manual",
        cache: "no-store",
        signal,
      })
      const traceId = str(response.headers.get("heedeo-trace-id"), 64)
      if (response.ok) {
        const json = await readJson(response, signal)
        return record(json)
          ? {
              outcome: "success",
              httpStatus: response.status,
              errorCode: null,
              traceId,
              attempts: attempt,
              answer: json,
            }
          : {
              outcome: "malformed",
              httpStatus: response.status,
              errorCode: null,
              traceId,
              attempts: attempt,
              answer: null,
            }
      }
      let errorCode: string | null = null
      try {
        const json = await readJson(response, signal)
        const code = record(json) && record(json.error) ? json.error.code : null
        errorCode =
          typeof code === "string" && /^[a-z_]{1,40}$/.test(code) ? code : null
      } catch {
        // The status is enough.
      }
      last = {
        outcome: `http_${response.status}`,
        httpStatus: response.status,
        errorCode,
        traceId,
        attempts: attempt,
        answer: null,
      }
      if (response.status < 500) return last
    } catch (error) {
      const timedOut =
        signal.aborted ||
        (error instanceof Error &&
          (error.name === "TimeoutError" || error.name === "AbortError"))
      last = {
        outcome: timedOut
          ? "timeout"
          : error instanceof SyntaxError
            ? "malformed"
            : "error",
        httpStatus: null,
        errorCode: null,
        traceId: null,
        attempts: attempt,
        answer: null,
      }
      if (timedOut || error instanceof SyntaxError) return last
    }
  }
  return last
}

// Keeps analytics properties bounded whatever Heedeo answers.
function bounded(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === "boolean") return value
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value === "string") return value.slice(0, 500)
  if (depth >= 6) return null
  if (Array.isArray(value))
    return value.slice(0, 25).map((item) => bounded(item, depth + 1))
  if (record(value)) {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value).slice(0, 60))
      out[key.slice(0, 64)] = bounded(value[key], depth + 1)
    return out
  }
  return null
}

const RESPONSE_PROPERTY_MAX = 32_000

/** The documented answer, bounded, for the `heedeo_response` property. */
export function heedeoResponseProperty(
  answer: Record<string, unknown>,
): Record<string, unknown> {
  const kept: Record<string, unknown> = {}
  for (const field of ANSWER_FIELDS)
    if (field in answer) kept[field] = bounded(answer[field])
  if (JSON.stringify(kept).length <= RESPONSE_PROPERTY_MAX) return kept
  // Lists can be long for a busy visitor; the flattened properties keep the
  // facts that matter.
  const { related: _related, visitor, ...rest } = kept
  const slim = {
    ...rest,
    ...(record(visitor)
      ? { visitor: { ...visitor, browsers: undefined, aliases: undefined } }
      : {}),
    truncated: true,
  }
  return JSON.stringify(slim).length <= RESPONSE_PROPERTY_MAX
    ? slim
    : { event_id: kept.event_id ?? null, truncated: true }
}

function reasonCodes(answer: Record<string, unknown> | null): string[] {
  if (!answer || !Array.isArray(answer.reasons)) return []
  return answer.reasons
    .map((reason) => (record(reason) ? str(reason.code, 64) : null))
    .filter((code): code is string => code !== null)
    .slice(0, 40)
}

/**
 * Sends the sign-up to Heedeo and records the answer. Never throws: failures
 * are recorded as `provider_outcome`, and analytics failures are ignored.
 */
export async function observeHeedeoSignup(
  observation: HeedeoSignupObservation,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  try {
    await collect(observation, fetchImpl)
  } catch {
    // Telemetry only. Do not log the error: it may hold the request.
  }
}

async function collect(
  {
    signupAttemptId,
    signupMethod,
    email,
    userId,
    status,
    capture,
    request,
    oauthEmailVerified,
  }: HeedeoSignupObservation,
  fetchImpl: typeof fetch,
): Promise<void> {
  const secretKey = heedeoSecretKey()
  if (!isHeedeoObservationEnabled() || !secretKey) return
  const requestId = signupAttemptId || crypto.randomUUID()
  const token = capture?.status === "ok" ? capture.token : null
  const body = JSON.stringify({
    action: "signup",
    ...(token ? { token } : {}),
    ...(email ? { email: email.slice(0, 320) } : {}),
    ...(userId ? { user_id: userId } : {}),
    ...(request?.clientIp ? { client_ip: request.clientIp } : {}),
    ...(request ? { headers: request.headers } : {}),
    request_id: requestId,
    status,
    ...(oauthEmailVerified !== undefined
      ? {
          evidence: {
            oauth: { provider: "google", email_verified: oauthEmailVerified },
          },
        }
      : {}),
  })
  const started = Date.now()
  const result = await evaluate(secretKey, body, fetchImpl)
  const latencyMs = Date.now() - started
  const answer = result.answer
  const visitor = answer && record(answer.visitor) ? answer.visitor : null
  const decision = answer && record(answer.decision) ? answer.decision : null
  const codes = reasonCodes(answer)
  const summary = {
    signup_attempt_id: requestId,
    signup_method: signupMethod,
    signup_status: status,
    capture_status: capture?.status ?? "absent",
    provider_outcome: result.outcome,
    provider_http_status: result.httpStatus,
    provider_trace_id: result.traceId,
    provider_latency_ms: latencyMs,
    heedeo_event_id: str(answer?.event_id, 64),
    heedeo_visitor_id: str(visitor?.id, 64),
    flagged: bool(answer?.flagged),
    score: num(answer?.score),
    band: str(answer?.suggested, 16),
    reason_codes: codes,
  }
  console.info("Heedeo signup observation outcome", summary)
  await trackEvent(AUTH_EVENTS.HEEDEO_SIGNUP_OBSERVED, userId || requestId, {
    provider: "heedeo",
    mode: "observe",
    ...summary,
    superserve_user_id: userId,
    capture_latency_ms: capture?.latencyMs ?? null,
    token_present: token !== null,
    provider_error_code: result.errorCode,
    provider_attempts: result.attempts,
    no_token: bool(answer?.no_token),
    flag: bool(answer?.flag),
    threshold: num(answer?.threshold),
    decision_risk: str(decision?.risk, 64),
    decision_by: str(decision?.by, 32),
    listed: str(answer?.listed, 16),
    visitor_confidence: num(visitor?.confidence),
    heedeo_response: answer ? heedeoResponseProperty(answer) : null,
    api_version: HEEDEO_API_VERSION,
    observed_at: new Date().toISOString(),
  })
}

/**
 * Runs `observeHeedeoSignup` after the response is sent. `observation` may be
 * a function, read when the callback runs, so a caller can pass the account
 * its later steps created. Does nothing when the observation is off, and never
 * throws.
 */
export function scheduleHeedeoSignupObservation(
  observation: HeedeoSignupObservation | (() => HeedeoSignupObservation),
): void {
  if (!isHeedeoObservationEnabled()) return
  try {
    after(() =>
      observeHeedeoSignup(
        typeof observation === "function" ? observation() : observation,
      ),
    )
  } catch {
    // Observation only: `after` throws outside a request scope.
  }
}
