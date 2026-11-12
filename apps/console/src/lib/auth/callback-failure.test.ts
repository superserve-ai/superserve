import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
const mockTrackEvent = vi.fn(async (..._args: unknown[]) => {})
vi.mock("@/lib/posthog/actions", () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}))

// Callbacks that next/server `after` would run once the response is sent.
const afterQueue: Array<() => unknown> = []
vi.mock("next/server", () => ({
  after: (fn: () => unknown) => {
    afterQueue.push(fn)
  },
}))
async function runAfter() {
  for (const fn of afterQueue.splice(0)) await fn()
}

import { trackCallbackFailure } from "./callback-failure"

describe("trackCallbackFailure", () => {
  beforeEach(() => {
    mockTrackEvent.mockReset().mockResolvedValue(undefined)
    afterQueue.length = 0
  })

  it("sends nothing until the response is out", () => {
    trackCallbackFailure({ reason: "missing_code", method: "none", type: null })
    expect(mockTrackEvent).not.toHaveBeenCalled()
    expect(afterQueue).toHaveLength(1)
  })

  it("uses the user ID and keeps the person profile when the user is known", async () => {
    trackCallbackFailure({
      reason: "enterprise_hold_failed",
      method: "code",
      type: null,
      userId: "u1",
    })
    await runAfter()
    expect(mockTrackEvent).toHaveBeenCalledWith("auth_callback_failed", "u1", {
      method: "code",
      type: null,
      error_code: null,
      reason: "enterprise_hold_failed",
    })
  })

  it("uses a fresh anonymous ID without a person profile otherwise", async () => {
    const failure = {
      reason: "otp_failed",
      method: "token_hash",
      type: "recovery",
      errorCode: "otp_expired",
    } as const
    trackCallbackFailure(failure)
    trackCallbackFailure(failure)
    await runAfter()
    const [first, second] = mockTrackEvent.mock.calls
    expect(first[1]).toMatch(/^[0-9a-f-]{36}$/)
    expect(second[1]).not.toBe(first[1])
    expect(first[2]).toEqual({
      method: "token_hash",
      type: "recovery",
      error_code: "otp_expired",
      reason: "otp_failed",
      $process_person_profile: false,
    })
  })

  it("never forwards free text in type or error_code", async () => {
    trackCallbackFailure({
      reason: "otp_failed",
      method: "token_hash",
      type: "user@example.com",
      errorCode: "Token abc123 for user@example.com expired",
    })
    await runAfter()
    expect(mockTrackEvent.mock.calls[0][2]).toMatchObject({
      type: "other",
      error_code: null,
    })
  })

  it("swallows tracking failures", async () => {
    mockTrackEvent.mockRejectedValueOnce(new Error("posthog down"))
    trackCallbackFailure({ reason: "missing_code", method: "none", type: null })
    await expect(runAfter()).resolves.toBeUndefined()
  })
})
