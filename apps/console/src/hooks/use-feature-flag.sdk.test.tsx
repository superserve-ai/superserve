import { act, renderHook, waitFor } from "@testing-library/react"
import posthog from "posthog-js"
import { describe, expect, it, vi } from "vitest"

vi.mock("posthog-js/react", () => ({ usePostHog: () => posthog }))

import { useFeatureFlagOn } from "./use-feature-flag"

const FLAG = "trial-runway-warning"
// PostHog keeps a reference to fetch when it loads, so stub it first.
const { responses, fetchMock } = vi.hoisted(() => {
  const responses: unknown[] = []
  const fetchMock = vi.fn(async (url: string) => {
    const body = String(url).includes("/flags") ? (responses.shift() ?? {}) : {}
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  })
  globalThis.fetch = fetchMock as unknown as typeof fetch
  return { responses, fetchMock }
})

function flags(enabled: boolean, failed = false) {
  return {
    errorsWhileComputingFlags: failed,
    flags: {
      [FLAG]: {
        key: FLAG,
        enabled,
        failed,
        reason: { code: failed ? "error" : "condition_match" },
        metadata: { id: 1, version: 1 },
      },
    },
  }
}

describe("useFeatureFlagOn with the PostHog SDK", () => {
  it("turns off when PostHog fails to evaluate the flag", async () => {
    responses.push(flags(true))
    posthog.init("phc_test", {
      api_host: "https://ph.example.com",
      persistence: "memory",
      autocapture: false,
      capture_pageview: false,
      disable_session_recording: true,
      advanced_disable_toolbar_metrics: true,
      disable_external_dependency_loading: true,
    })
    const { result } = renderHook(() => useFeatureFlagOn(FLAG))
    await waitFor(() => expect(result.current).toBe(true))

    responses.push(flags(false, true))
    act(() => posthog.reloadFeatureFlags())
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(1))
    await waitFor(() => expect(result.current).toBe(false))
  })
})
