import type { PostHog } from "posthog-js"
import { expect, it, vi } from "vitest"

import {
  captureCreateMeasurement,
  restrictCreateMeasurement,
  snapshotCreateIdentity,
} from "./create-measurement"

it("removes automatic URL, input, attribution and person enrichment only from new Create events", () => {
  const event = {
    event: "sandbox_create_submitted",
    properties: {
      distinct_id: "existing-actor",
      $groups: { team: "existing-team" },
      token: "public-project-ingestion-token",
      schema_version: 1,
      emitter: "console_browser",
      flow_id: "flow",
      attempt_id: "attempt",
      $process_person_profile: true,
      $geoip_disable: false,
      $current_url: "https://example.com/private",
      $referrer: "private",
      first_landing_path: "/private",
      $device_id: "device",
      name: "private input",
      $set: { email: "private" },
    },
    $set: { email: "private" },
    $set_once: { $initial_current_url: "private" },
  }
  expect(restrictCreateMeasurement(event)).toEqual({
    event: event.event,
    properties: {
      distinct_id: "existing-actor",
      $groups: { team: "existing-team" },
      token: "public-project-ingestion-token",
      schema_version: 1,
      emitter: "console_browser",
      flow_id: "flow",
      attempt_id: "attempt",
      $process_person_profile: false,
      $geoip_disable: true,
    },
  })
  const legacy = { ...event, event: "sandbox_created" }
  expect(restrictCreateMeasurement(legacy)).toBe(legacy)
  expect(restrictCreateMeasurement(null)).toBeNull()
})

it("keeps the submitting identity after analytics reset without changing global identity", () => {
  let actor = "original-user"
  const groups = { team: "original-team" }
  const capture = vi.fn()
  const posthog = {
    capture,
    get_distinct_id: () => actor,
    getGroups: () => groups,
  } as unknown as PostHog
  const identity = snapshotCreateIdentity(posthog)
  actor = "replacement-user"
  groups.team = "replacement-team"
  captureCreateMeasurement(
    posthog,
    "sandbox_create_client_result",
    "flow",
    "attempt",
    {
      outcome: "http_success",
      request_dispatched: true,
      request_id: null,
      http_status: 201,
      error_code: null,
      sandbox_id: null,
    },
    identity,
  )
  expect(capture).toHaveBeenCalledWith(
    "sandbox_create_client_result",
    expect.objectContaining({
      distinct_id: "original-user",
      $groups: { team: "original-team" },
    }),
  )
  expect(posthog.get_distinct_id()).toBe("replacement-user")
  expect(posthog.getGroups()).toEqual({ team: "replacement-team" })
})
