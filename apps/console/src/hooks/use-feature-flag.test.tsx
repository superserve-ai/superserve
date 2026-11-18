import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  posthog: undefined as
    | {
        isFeatureEnabled: ReturnType<typeof vi.fn>
        onFeatureFlags: ReturnType<typeof vi.fn>
      }
    | undefined,
}))
vi.mock("posthog-js/react", () => ({ usePostHog: () => mocks.posthog }))

import { useFeatureFlagOn } from "./use-feature-flag"

function client(value: unknown) {
  return {
    isFeatureEnabled: vi.fn(() => value),
    onFeatureFlags: vi.fn(() => () => {}),
  }
}

beforeEach(() => {
  mocks.posthog = undefined
})

describe("useFeatureFlagOn", () => {
  it("is on only when PostHog says the flag is on", () => {
    mocks.posthog = client(true)
    expect(renderHook(() => useFeatureFlagOn("f")).result.current).toBe(true)
    // Cached values from an earlier page load do not count.
    expect(mocks.posthog.isFeatureEnabled).toHaveBeenCalledWith("f", {
      fresh: true,
    })
  })

  it("is off when the flags request fails", () => {
    mocks.posthog = client(true)
    let loaded = (..._args: unknown[]) => {}
    mocks.posthog.onFeatureFlags.mockImplementation(
      (callback: (...args: unknown[]) => void) => {
        loaded = callback
        return () => {}
      },
    )
    const { result } = renderHook(() => useFeatureFlagOn("f"))
    expect(result.current).toBe(true)
    act(() => loaded([], {}, { errorsLoading: true }))
    expect(result.current).toBe(false)
  })

  it("is off when the flag subscription fails", () => {
    mocks.posthog = client(true)
    mocks.posthog.onFeatureFlags.mockImplementation(() => {
      throw new Error("posthog failed")
    })
    expect(renderHook(() => useFeatureFlagOn("f")).result.current).toBe(false)
  })

  it.each([
    ["not loaded or not defined", undefined],
    ["off", false],
  ])("is off when the flag is %s", (_, value) => {
    mocks.posthog = client(value)
    expect(renderHook(() => useFeatureFlagOn("f")).result.current).toBe(false)
  })

  it("is off without a PostHog client", () => {
    expect(renderHook(() => useFeatureFlagOn("f")).result.current).toBe(false)
  })

  it("is off when PostHog throws", () => {
    mocks.posthog = client(true)
    mocks.posthog.isFeatureEnabled.mockImplementation(() => {
      throw new Error("posthog failed")
    })
    mocks.posthog.onFeatureFlags.mockImplementation(() => {
      throw new Error("posthog failed")
    })
    expect(renderHook(() => useFeatureFlagOn("f")).result.current).toBe(false)
  })

  it("does not read the flag while disabled", () => {
    mocks.posthog = client(true)
    expect(renderHook(() => useFeatureFlagOn("f", false)).result.current).toBe(
      false,
    )
    expect(mocks.posthog.isFeatureEnabled).not.toHaveBeenCalled()
  })

  it("follows flags that load later", () => {
    mocks.posthog = client(undefined)
    let loaded = () => {}
    mocks.posthog.onFeatureFlags.mockImplementation((callback: () => void) => {
      loaded = callback
      return () => {}
    })
    const { result } = renderHook(() => useFeatureFlagOn("f"))
    expect(result.current).toBe(false)
    mocks.posthog.isFeatureEnabled.mockReturnValue(true)
    act(() => loaded())
    expect(result.current).toBe(true)
  })
})
