import { beforeEach, expect, it, vi } from "vitest"

const m = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_POSTHOG_KEY = "test-key"
  return { capture: vi.fn(), flush: vi.fn(async () => {}) }
})
vi.mock("posthog-node", () => ({
  PostHog: class {
    capture = m.capture
    flush = m.flush
  },
}))

import { trackEvent } from "./actions"

beforeEach(() => m.capture.mockClear())

it("passes the time the event happened to PostHog when one is given", async () => {
  const timestamp = new Date("2026-11-13T00:00:00.000Z")
  await trackEvent("checkout_returned", "u1", { outcome: "success" }, timestamp)
  expect(m.capture).toHaveBeenCalledWith({
    distinctId: "u1",
    event: "checkout_returned",
    properties: { outcome: "success" },
    timestamp,
  })
})

it("leaves the timestamp to PostHog when none is given", async () => {
  await trackEvent("sandbox_created", "u1", { region: "use" })
  expect(m.capture).toHaveBeenCalledWith({
    distinctId: "u1",
    event: "sandbox_created",
    properties: { region: "use" },
  })
})
