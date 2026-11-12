import { describe, expect, it } from "vitest"

import { confirmedSignupReturnPath } from "./signup-return-path"

describe("confirmedSignupReturnPath", () => {
  it.each([
    ["/", undefined, "/"],
    ["/yc/claim", undefined, "/yc/claim"],
    ["/yc/claim", "pro_monthly", "/yc/claim"],
    ["/", "pro_monthly", "/billing/pro/"],
    ["/", "enterprise", "/"],
    ["//attacker.example", undefined, "/"],
    ["/\\attacker.example", undefined, "/"],
    ["/path\twith-tab", undefined, "/"],
    ["https://console.superserve.ai/sandboxes", undefined, "/"],
  ])("sends next %s with offer %s to %s", (next, offer, expected) => {
    expect(confirmedSignupReturnPath(next, offer)).toBe(expected)
  })
})
