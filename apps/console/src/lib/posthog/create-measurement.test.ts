import { expect, it } from "vitest"

import { restrictCreateMeasurement } from "./create-measurement"

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
    },
  })
  const legacy = { ...event, event: "sandbox_created" }
  expect(restrictCreateMeasurement(legacy)).toBe(legacy)
  expect(restrictCreateMeasurement(null)).toBeNull()
})
