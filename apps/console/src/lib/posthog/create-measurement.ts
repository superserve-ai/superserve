import type { PostHog } from "posthog-js"

import type { CreateClientResult } from "@/lib/api/create-measurement"

import { SANDBOX_EVENTS } from "./events"

const events = new Set<string>([
  SANDBOX_EVENTS.CREATE_DIALOG_OPENED,
  SANDBOX_EVENTS.CREATE_SUBMITTED,
  SANDBOX_EVENTS.CREATE_CLIENT_RESULT,
])
const properties = new Set([
  "schema_version",
  "emitter",
  "event_time",
  "flow_id",
  "attempt_id",
  "outcome",
  "request_dispatched",
  "request_id",
  "http_status",
  "error_code",
  "sandbox_id",
  // Preserve the existing identified user and team, but not URL, referrer,
  // device, persisted attribution, feature flags, or person enrichment.
  "distinct_id",
  "$groups",
  "$lib",
  "$lib_version",
  "$process_person_profile",
])

/** Runs last in before_send, after the SDK adds automatic properties. */
export function restrictCreateMeasurement<
  T extends { event: string; properties: Record<string, unknown> },
>(event: T | null): T | null {
  if (!event || !events.has(event.event)) return event
  const clean = {
    ...event,
    properties: Object.fromEntries(
      Object.entries(event.properties).filter(
        ([key]) => properties.has(key) || key === "token",
      ),
    ),
  }
  // The SDK overwrites the capture-time person flag before before_send.
  clean.properties.$process_person_profile = false
  clean.properties.$geoip_disable = true
  // `token` is the existing SDK ingestion credential, not a measured property.
  // Removing it prevents delivery. Never copy application credentials here.
  Reflect.deleteProperty(clean, "$set")
  Reflect.deleteProperty(clean, "$set_once")
  return clean
}

export function captureCreateMeasurement(
  posthog: PostHog,
  event: string,
  flowId: string | null,
  attemptId?: string | null,
  result?: CreateClientResult,
) {
  try {
    posthog.capture(event, {
      schema_version: 1,
      emitter: "console_browser",
      event_time: new Date().toISOString(),
      flow_id: flowId,
      ...(attemptId ? { attempt_id: attemptId } : {}),
      ...result,
      $process_person_profile: false,
    })
  } catch {
    // No analytics failure may change Create or local validation.
  }
}

export function newCreateCorrelationId(): string | null {
  try {
    return crypto.randomUUID()
  } catch {
    return null
  }
}
