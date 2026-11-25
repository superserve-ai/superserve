import { afterEach, beforeEach, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ capture: vi.fn(), flush: vi.fn() }))
vi.mock("posthog-node", () => ({
  PostHog: class {
    capture = mocks.capture
    flush = mocks.flush
  },
}))

beforeEach(() => {
  vi.resetModules()
  vi.resetAllMocks()
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "test-key")
  mocks.flush.mockResolvedValue(undefined)
})
afterEach(() => vi.unstubAllEnvs())

it("preserves occurrence time when analytics is delivered later", async () => {
  const { trackEvent } = await import("./actions")
  const occurredAt = new Date("2026-01-01T12:00:00Z")
  await trackEvent("signed_up", "user-1", { provider: "google" }, occurredAt)
  expect(mocks.capture).toHaveBeenCalledExactlyOnceWith({
    event: "signed_up",
    distinctId: "user-1",
    properties: { provider: "google" },
    timestamp: occurredAt,
  })
  expect(mocks.flush).toHaveBeenCalledOnce()
})

it("keeps existing callers on the SDK's default occurrence time", async () => {
  const { trackEvent } = await import("./actions")
  await trackEvent("signed_in", "user-1")
  expect(mocks.capture).toHaveBeenCalledExactlyOnceWith({
    event: "signed_in",
    distinctId: "user-1",
    properties: {},
  })
})
