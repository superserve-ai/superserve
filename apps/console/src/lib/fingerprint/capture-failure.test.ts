import { describe, expect, it } from "vitest"

import { signupCaptureFailure } from "./capture-failure"
import { sdkDiagnosticReason } from "./diagnostics"

function report(...events: Array<Record<string, unknown>>) {
  return {
    schema_version: 1,
    events: events.map((event) =>
      Object.assign(
        {
          stage: "capture",
          outcome: "unknown",
          occurred_at: "2026-11-12T13:00:00.000Z",
        },
        event,
      ),
    ),
  }
}

describe("signupCaptureFailure", () => {
  it("reports a device script blocked in the browser", () => {
    expect(
      signupCaptureFailure(
        report({ reason: sdkDiagnosticReason({ code: "script_load_fail" }) }),
      ),
    ).toBe("script_load_fail")
    // A form retry after the blocked script adds an incomplete capture.
    expect(
      signupCaptureFailure(
        report(
          {
            stage: "capture_attempt",
            outcome: "succeeded",
            reason: "completed",
          },
          { reason: "script_load_fail" },
          { reason: "incomplete_capture" },
        ),
      ),
    ).toBe("script_load_fail")
  })

  it.each([
    ["sdk_error", { reason: "sdk_error" }],
    [
      "provider 403",
      {
        reason: sdkDiagnosticReason(new Error("403 Forbidden")),
        http_status: 403,
      },
    ],
    ["provider 5xx", { reason: "sdk_error", http_status: 503 }],
    ["incomplete_capture", { reason: "incomplete_capture" }],
    ["client_timeout", { reason: "client_timeout" }],
    ["network_connection", { reason: "network_connection" }],
    ["bad_response_format", { reason: "bad_response_format" }],
    ["missing_event_id", { reason: "missing_event_id" }],
    ["csp_block", { reason: "csp_block" }],
  ])("does not report a provider-side or other failure: %s", (_, event) => {
    expect(signupCaptureFailure(report(event))).toBeUndefined()
  })

  it.each([
    ["no report", undefined],
    ["a malformed report", { schema_version: 2, events: [] }],
    ["an empty report", report()],
    [
      "a blocked script outside the capture stage",
      report({ stage: "storage_read", reason: "script_load_fail" }),
    ],
    [
      "an unsanitizable row",
      report({ reason: "script_load_fail", occurred_at: "never" }),
    ],
  ])("does not report a blocked script for %s", (_, value) => {
    expect(signupCaptureFailure(value)).toBeUndefined()
  })
})
