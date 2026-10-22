import { afterEach, expect, it, vi } from "vitest"

import { ycClaimCaptureURL } from "./capture-url"

afterEach(() => vi.unstubAllEnvs())

it("preserves the production destination only when configuration is absent", () => {
  vi.stubEnv("YC_CLAIM_WEBSITE_URL", undefined)
  expect(ycClaimCaptureURL()).toBe("https://www.superserve.ai/yc")
})
it.each([
  ["https://capture.example.test", "https://capture.example.test/yc"],
  ["https://capture.example.test/", "https://capture.example.test/yc"],
  ["https://capture.example.test:8443", "https://capture.example.test:8443/yc"],
  ["http://127.0.0.1:3001", "http://127.0.0.1:3001/yc"],
  ["http://localhost:46301/", "http://localhost:46301/yc"],
  ["http://[::1]:3001", "http://[::1]:3001/yc"],
])(
  "uses the configured browser origin %s with the fixed capture path",
  (origin, expected) => {
    vi.stubEnv("YC_CLAIM_WEBSITE_URL", origin)
    expect(ycClaimCaptureURL()).toBe(expected)
  },
)
it.each([
  "",
  " ",
  "http://capture.example.test",
  "//capture.example.test",
  "javascript:alert(1)",
  "https://user:pass@capture.example.test",
  "https://user@capture.example.test",
  "https://@capture.example.test",
  "https://:@capture.example.test",
  "https://capture.example.test/other",
  "https://capture.example.test/yc",
  "https://capture.example.test/a/..",
  "https://capture.example.test?next=elsewhere",
  "https://capture.example.test?",
  "https://capture.example.test#fragment",
  "https://capture.example.test#",
  "https://capture.example.test\\elsewhere",
  "https://capture.example.test\n",
  "https://",
])(
  "does not fall back to production for invalid configuration %j",
  (origin) => {
    vi.stubEnv("YC_CLAIM_WEBSITE_URL", origin)
    expect(ycClaimCaptureURL()).toBeNull()
  },
)
