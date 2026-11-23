import type { PostHog } from "posthog-js"
import { afterEach, expect, it, vi } from "vitest"

const TOKEN = "ssinv_use_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v"
let client: PostHog | undefined

afterEach(async () => {
  client?.opt_out_capturing()
  client = undefined
  if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(15_000)
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  window.localStorage.clear()
  window.sessionStorage.clear()
  window.history.replaceState(null, "", "/")
})

it("adds native load timings through the real SDK while keeping redaction last", async () => {
  vi.useFakeTimers()
  window.history.replaceState(null, "", `/invite/${TOKEN}/`)
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "browser-performance-test")
  const address = window.location.href
  vi.spyOn(performance, "getEntriesByType").mockImplementation((type) =>
    type === "navigation"
      ? [
          {
            name: address,
            type: "navigate",
            startTime: 0,
            requestStart: 100,
            responseStart: 2500,
            responseEnd: 2600,
          } as PerformanceNavigationTiming,
        ]
      : [],
  )

  const { default: posthog } = await import("posthog-js")
  client = posthog
  // Keep the real capture/copy/before_send pipeline, but stop before any SDK
  // transport. The SDK can retain a fetch reference from an earlier import.
  const send = vi.spyOn(posthog, "_send_request").mockImplementation(() => {})
  const init = posthog.init.bind(posthog)
  const beforeCopy = Object.defineProperties(
    {},
    {
      url: { get: () => "https://example.com/?token=private-resource" },
      startTime: { get: () => 2500 },
    },
  )
  const seen: unknown[] = []
  vi.spyOn(posthog, "init").mockImplementation((key, config) => {
    const beforeSend = config?.before_send
    expect(typeof beforeSend).toBe("function")
    return init(key, {
      ...config,
      autocapture: false,
      advanced_disable_flags: true,
      opt_out_useragent_filter: true,
      capture_pageleave: false,
      capture_performance: false,
      disable_external_dependency_loading: true,
      disable_session_recording: true,
      remote_config_refresh_interval_ms: 0,
      request_batching: false,
      before_send: (event) => {
        if (event?.event === "$web_vitals")
          seen.push(event.properties.$web_vitals_LCP_event.entries)
        return typeof beforeSend === "function" ? beforeSend(event) : event
      },
    })
  })
  await import("./posthog-provider")

  const result = posthog.capture("$web_vitals", {
    $web_vitals_LCP_event: {
      name: "LCP",
      value: 5048,
      navigationType: "navigate",
      $current_url: address,
      entries: [beforeCopy],
      attribution: { target: "#private-selector", url: "private-resource" },
    },
  })

  // The pinned SDK copies only enumerable entry fields before before_send.
  expect(seen).toEqual([[{}]])
  expect(result?.properties.$web_vitals_LCP_event.navigation_timing).toEqual({
    schema_version: 1,
    scope: "document",
    ttfb_ms: 2500,
    request_to_first_byte_ms: 2400,
    response_download_ms: 100,
    first_byte_to_lcp_ms: 2548,
    response_end_to_lcp_ms: 2448,
  })
  expect(JSON.stringify(result)).not.toContain(TOKEN)
  expect(JSON.stringify(result)).not.toMatch(/private-(selector|resource)/)
  expect(result?.properties.$web_vitals_LCP_event.$current_url).toContain(
    "/invite/ssinv_redacted/",
  )
  expect(send).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ event: "$web_vitals" }),
    }),
  )
  const requests = send.mock.calls.length
  await vi.advanceTimersByTimeAsync(15_000)
  expect(send).toHaveBeenCalledTimes(requests)
})
