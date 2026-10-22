import { afterEach, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
  shutdown: vi.fn(),
  options: vi.fn(),
}))
vi.mock("posthog-node", () => ({
  PostHog: class {
    constructor(key: string, options: unknown) {
      mocks.options(key, options)
    }
    capture = mocks.capture
    shutdown = mocks.shutdown
  },
}))
import { trackEventBatch } from "./batch"
afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetAllMocks()
})
it("bounds event volume and delivery retries without creating clients when unconfigured", async () => {
  const events = Array.from({ length: 100 }, () => ({
    event: "diagnostic",
    distinctId: "run",
    properties: {},
  }))
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "")
  await trackEventBatch(events)
  expect(mocks.options).not.toHaveBeenCalled()
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "test-key")
  mocks.shutdown.mockRejectedValue(new Error("delivery unavailable"))
  await expect(trackEventBatch(events)).resolves.toBeUndefined()
  expect(mocks.capture).toHaveBeenCalledTimes(12)
  expect(mocks.shutdown).toHaveBeenCalledOnce()
  expect(mocks.options).toHaveBeenCalledWith(
    "test-key",
    expect.objectContaining({
      requestTimeout: 1500,
      fetchRetryCount: 0,
      flushAt: 20,
      flushInterval: 0,
    }),
  )
})
