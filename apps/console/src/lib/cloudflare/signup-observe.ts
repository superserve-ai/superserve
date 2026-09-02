import { trackEvent } from "@/lib/posthog/actions"
import { AUTH_EVENTS } from "@/lib/posthog/events"
import { createAdminClient } from "@/lib/supabase/admin"

const TIMEOUT_MS = 1500
const MAX_SIGNAL_KEYS = 40

export type CloudflareSignupObservation = {
  signupAttemptId: string
  signupMethod: "email" | "google"
  userId?: string | null
  teamId?: string | null
  clientContext?: {
    userAgent?: string | null
    ip?: string | null
    ray?: string | null
  }
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const CLOUDFLARE_SIGNUP_FLAG_KEY = "cloudflare_signup_observation"

function hasMeaningfulValue(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (typeof value === "string") return value.length > 0
  if (typeof value === "number" || typeof value === "boolean") return true
  if (Array.isArray(value)) return value.length > 0
  if (record(value)) return Object.keys(value).length > 0
  return false
}

function hasUsefulCloudflarePayload(payload: Record<string, unknown>): boolean {
  return [
    "event_id",
    "request_id",
    "challenge_id",
    "ephemeral_id",
    "device_id",
    "bot_verdict",
    "account_abuse_verdict",
    "capabilities",
    "signals",
  ].some((key) => hasMeaningfulValue(payload[key]))
}

async function isCloudflareSignupObservationEnabled(): Promise<boolean | null> {
  try {
    const admin = createAdminClient()
    const { data, error } = await admin.rpc("feature_enabled", {
      flag_key: CLOUDFLARE_SIGNUP_FLAG_KEY,
      flag_team_id: null,
    })
    if (error) return null
    return Boolean(data)
  } catch {
    return null
  }
}

function safeSignals(value: unknown): Record<string, unknown> {
  if (!record(value)) return {}
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, val]) =>
        /token|secret|cookie|authorization|password|credential/i.test(key)
          ? false
          : ["string", "number", "boolean"].includes(typeof val),
      )
      .slice(0, MAX_SIGNAL_KEYS),
  )
}

/** Observe Cloudflare capabilities without ever making signup depend on them. */
export async function observeCloudflareSignup({
  signupAttemptId,
  signupMethod,
  userId = null,
  teamId = null,
  clientContext,
}: CloudflareSignupObservation): Promise<void> {
  const endpoint = process.env.CLOUDFLARE_SIGNUP_OBSERVATION_URL
  const secret = process.env.CLOUDFLARE_SIGNUP_OBSERVATION_SECRET
  const configVersion = process.env.CLOUDFLARE_SIGNUP_CONFIG_VERSION || "v1"
  const configuredCapabilities = (
    process.env.CLOUDFLARE_SIGNUP_CAPABILITIES || ""
  )
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 20)
  if (!endpoint || !secret || !signupAttemptId) return
  const enabled = await isCloudflareSignupObservationEnabled()
  if (enabled === null) {
    await trackEvent(
      AUTH_EVENTS.CLOUDFLARE_SIGNUP_OBSERVATION_FAILED,
      signupAttemptId,
      {
        provider: "cloudflare",
        signup_attempt_id: signupAttemptId,
        signup_method: signupMethod,
        provider_outcome: "configuration_lookup_failed",
        config_version: configVersion,
        observed_at: new Date().toISOString(),
      },
    )
    console.warn(
      "Cloudflare signup observation flag lookup failed; failing open",
    )
    return
  }
  if (!enabled) return

  const started = Date.now()
  let outcome = "success"
  let payload: Record<string, unknown> = {}
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({
        signup_attempt_id: signupAttemptId,
        signup_method: signupMethod,
        client_context: {
          user_agent: clientContext?.userAgent || null,
          ip: clientContext?.ip || null,
          ray: clientContext?.ray || null,
        },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    })
    if (!response.ok)
      outcome =
        response.status === 404
          ? "feature_not_entitled"
          : `http_${response.status}`
    else {
      try {
        const json: unknown = await response.json()
        if (!record(json) || !hasUsefulCloudflarePayload(json)) {
          outcome = "malformed"
        } else {
          payload = json
        }
      } catch {
        outcome = "malformed"
      }
    }
  } catch (error) {
    outcome =
      error instanceof Error && error.name === "TimeoutError"
        ? "timeout"
        : "error"
  }

  const providerEventId =
    typeof payload.event_id === "string" ? payload.event_id : null
  const providerRequestId =
    typeof payload.request_id === "string" ? payload.request_id : null
  const challengeId =
    typeof payload.challenge_id === "string" ? payload.challenge_id : null
  const ephemeralId =
    typeof payload.ephemeral_id === "string" ? payload.ephemeral_id : null
  const deviceId =
    typeof payload.device_id === "string" ? payload.device_id : null
  await trackEvent(
    AUTH_EVENTS.CLOUDFLARE_SIGNUP_OBSERVED,
    userId || signupAttemptId,
    {
      provider: "cloudflare",
      signup_attempt_id: signupAttemptId,
      provider_event_id: providerEventId,
      provider_request_id: providerRequestId,
      challenge_id: challengeId,
      ephemeral_id: ephemeralId,
      device_id: deviceId,
      bot_verdict: payload.bot_verdict ?? null,
      account_abuse_verdict: payload.account_abuse_verdict ?? null,
      capabilities: Array.isArray(payload.capabilities)
        ? payload.capabilities.slice(0, 20)
        : configuredCapabilities,
      signals: safeSignals(payload.signals),
      config_version: configVersion,
      signup_method: signupMethod,
      superserve_user_id: userId,
      team_id: teamId,
      provider_latency_ms: Date.now() - started,
      provider_outcome: outcome,
      observed_at: new Date().toISOString(),
    },
  )
}
