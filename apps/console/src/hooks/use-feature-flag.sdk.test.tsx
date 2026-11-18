import { act, renderHook, waitFor } from "@testing-library/react"
import posthog from "posthog-js"
import { describe, expect, it, vi } from "vitest"

vi.mock("posthog-js/react", () => ({ usePostHog: () => posthog }))

import { trackFlagRequests, useFeatureFlagOn } from "./use-feature-flag"

const FLAG = "trial-runway-warning"
// PostHog keeps a reference to fetch when it loads, so stub it first.
const { responses, fetchMock } = vi.hoisted(() => {
  const responses: unknown[] = []
  const fetchMock = vi.fn(async (url: string) => {
    // A queued promise holds the flags response until the test resolves it.
    const body = String(url).includes("/flags")
      ? await (responses.shift() ?? {})
      : {}
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

function initPostHog() {
  if (posthog.__loaded) return
  posthog.init("phc_test", {
    api_host: "https://ph.example.com",
    persistence: "memory",
    autocapture: false,
    capture_pageview: false,
    disable_session_recording: true,
    advanced_disable_toolbar_metrics: true,
    disable_external_dependency_loading: true,
  })
  // As in the PostHog provider.
  trackFlagRequests(posthog)
}

async function loadFlags(response: unknown) {
  const calls = fetchMock.mock.calls.length
  responses.push(response)
  if (posthog.__loaded) act(() => posthog.reloadFeatureFlags())
  else initPostHog()
  await waitFor(() =>
    expect(fetchMock.mock.calls.length).toBeGreaterThan(calls),
  )
}

describe("useFeatureFlagOn with the PostHog SDK", () => {
  it("turns off when PostHog fails to evaluate the flag", async () => {
    await loadFlags(flags(true))
    const { result } = renderHook(() => useFeatureFlagOn(FLAG))
    await waitFor(() => expect(result.current).toBe(true))

    await loadFlags(flags(false, true))
    await waitFor(() => expect(result.current).toBe(false))
  })

  it("turns off when PostHog hits the flags quota", async () => {
    await loadFlags(flags(true))
    const { result } = renderHook(() => useFeatureFlagOn(FLAG))
    await waitFor(() => expect(result.current).toBe(true))

    await loadFlags({ quotaLimited: ["feature_flags"] })
    await waitFor(() =>
      expect(posthog.get_property("$feature_flag_errors")).toContain(
        "quota_limited",
      ),
    )
    // PostHog keeps the old ON value and does not call onFeatureFlags.
    expect(posthog.isFeatureEnabled(FLAG, { fresh: true })).toBe(true)
    expect(result.current).toBe(false)
  })

  it("stays off when it mounts during a flags request", async () => {
    await loadFlags(flags(true))
    let release = (_body: unknown) => {}
    await loadFlags(
      new Promise((resolve) => {
        release = resolve
      }),
    )
    // PostHog gives a new listener the old ON flags at once.
    const { result } = renderHook(() => useFeatureFlagOn(FLAG))
    expect(result.current).toBe(false)

    release(flags(true))
    await waitFor(() => expect(result.current).toBe(true))
  })
})
