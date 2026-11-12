import { describe, expect, it } from "vitest"

import { confirmedSignupReturnPath } from "./signup-return-path"

describe("confirmedSignupReturnPath", () => {
  it.each([
    ["/", "/"],
    ["/yc/claim", "/yc/claim"],
    [
      "/auth/choose-plan/?reason=trial_ended",
      "/auth/choose-plan/?reason=trial_ended",
    ],
    ["//attacker.example", "/"],
    ["/\\attacker.example", "/"],
    ["/path\twith-tab", "/"],
    ["https://console.superserve.ai/sandboxes", "/"],
  ])("sends next %s to %s", (next, expected) => {
    expect(confirmedSignupReturnPath(next)).toBe(expected)
  })
})
