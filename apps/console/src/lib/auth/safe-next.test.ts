import { describe, expect, it } from "vitest"

import { sanitizeNext } from "./safe-next"

describe("sanitizeNext", () => {
  it.each([
    "/\\evil.example/qa",
    "/\\\\evil",
    "/\t/evil",
    "/\n/evil",
    "/%5Cevil.example",
    "/%5cevil",
    "/%2F%2Fevil.example",
    "/%252F%252Fevil",
    "/%255Cevil",
    "/%25252525255Cevil",
    "/%09/evil",
    "/%0A/evil",
    "/%20/evil",
    "/%7F/evil",
    "//evil.example",
    "https://evil.example",
    "http://superserve.ai",
    "javascript:alert(1)",
    "https://evil.superserve.ai.evil.example/",
    "https://superserve.ai@evil.example",
    "https://console.superserve.ai/\t",
    "/%E0%A4%A",
    null,
    undefined,
    "",
  ])("falls back to / for %j", (next) => {
    expect(sanitizeNext(next)).toBe("/")
  })

  it.each([
    "/sandboxes?x=1",
    "/",
    "/yc/accept?claim=11111111-1111-4111-8111-111111111111",
    "/invite/ssinv_exampletoken",
    "/billing-usage/buy-credit/",
    "/search?q=caf%C3%A9",
    "https://console.superserve.ai/device/abc",
    "https://app.superserve.ai/device/abc",
    "https://superserve.ai",
  ])("preserves %s", (next) => {
    expect(sanitizeNext(next)).toBe(next)
  })
})
