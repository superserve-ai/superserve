import { describe, expect, it } from "vitest"

import {
  sanitizeDiagnostic,
  sdkDiagnosticDetails,
  sdkDiagnosticReason,
} from "./diagnostics"

describe("safe SDK error details", () => {
  it("retains JavaScript exception categories without their messages", () => {
    expect(sdkDiagnosticDetails(new TypeError("secret URL"))).toEqual({
      sdk_error_type: "TypeError",
    })
    expect(
      sdkDiagnosticDetails(new DOMException("secret URL", "SecurityError")),
    ).toEqual({
      sdk_error_type: "DOMException",
    })
    expect(
      sdkDiagnosticDetails({
        code: "new-unrecognized-code",
        name: "secret-name",
      }),
    ).toEqual({
      sdk_error_type: "unknown",
    })
  })

  it("keeps capture failure handling safe even when exception properties throw", () => {
    const error = new Proxy(
      {},
      {
        get() {
          throw new Error("secret getter")
        },
      },
    )
    expect(sdkDiagnosticDetails(error)).toEqual({ sdk_error_type: "unknown" })
    expect(sdkDiagnosticReason(error)).toBe("sdk_error")

    const revoked = Proxy.revocable({}, {})
    revoked.revoke()
    expect(sdkDiagnosticDetails(revoked.proxy)).toEqual({
      sdk_error_type: "unknown",
    })
    expect(sdkDiagnosticReason(revoked.proxy)).toBe("sdk_error")
  })

  it("restricts SDK details to uncertain capture diagnostics", () => {
    const row = {
      stage: "capture",
      outcome: "succeeded",
      reason: "completed",
      occurred_at: "2026-11-23T17:36:13.351Z",
      sdk_error_code: "wrong_region",
      sdk_error_type: "FingerprintError",
    }
    expect(sanitizeDiagnostic(row)).not.toHaveProperty("sdk_error_code")
    expect(
      sanitizeDiagnostic({
        ...row,
        stage: "storage_write",
        outcome: "unknown",
      }),
    ).not.toHaveProperty("sdk_error_code")
  })
})
