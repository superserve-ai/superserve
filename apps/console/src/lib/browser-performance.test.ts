import type { CaptureResult } from "posthog-js"
import { describe, expect, it, vi } from "vitest"

import { enrichWebVitals } from "./browser-performance"

const URL = "https://console.superserve.ai/sandboxes/"

function navigation(overrides: Record<string, unknown> = {}) {
  const fields = {
    name: URL,
    type: "navigate",
    startTime: 0,
    activationStart: 0,
    redirectStart: 10,
    redirectEnd: 110,
    domainLookupStart: 110,
    domainLookupEnd: 120,
    connectStart: 120,
    secureConnectionStart: 140,
    connectEnd: 180,
    requestStart: 200,
    responseStart: 2500,
    responseEnd: 2600,
    domInteractive: 4000,
    domContentLoadedEventEnd: 4100,
    loadEventEnd: 4200,
    ...overrides,
  }
  return Object.defineProperties(
    {},
    Object.fromEntries(
      Object.entries(fields).map(([key, value]) => [key, { get: () => value }]),
    ),
  ) as PerformanceNavigationTiming
}

function useNavigation(overrides: Record<string, unknown> = {}) {
  vi.spyOn(performance, "getEntriesByType").mockImplementation((type) =>
    type === "navigation" ? [navigation(overrides)] : [],
  )
}

function event(
  overrides: Record<string, unknown> = {},
  name = "LCP",
): CaptureResult {
  return {
    uuid: "test-event",
    event: "$web_vitals",
    properties: {
      [`$web_vitals_${name}_event`]: {
        name,
        value: 5048,
        navigationType: "navigate",
        $current_url: URL,
        ...overrides,
      },
    },
  }
}

function metric(input: CaptureResult, name = "LCP") {
  return enrichWebVitals(input)?.properties[`$web_vitals_${name}_event`]
}

describe("browser load timing diagnostics", () => {
  it("separates document network/server phases from the remaining paint work", () => {
    useNavigation()
    expect(metric(event()).navigation_timing).toEqual({
      schema_version: 1,
      scope: "document",
      ttfb_ms: 2500,
      redirect_ms: 100,
      dns_ms: 10,
      connection_ms: 60,
      tls_ms: 40,
      request_to_first_byte_ms: 2300,
      response_download_ms: 100,
      dom_interactive_ms: 4000,
      dom_content_loaded_ms: 4100,
      document_load_ms: 4200,
      first_byte_to_lcp_ms: 2548,
      response_end_to_lcp_ms: 2448,
    })
    expect(
      metric(event({ value: 4320 }, "FCP"), "FCP").navigation_timing,
    ).toMatchObject({ first_byte_to_fcp_ms: 1820 })
  })

  it("omits unavailable, unfinished, invalid, and opaque phases", () => {
    useNavigation({
      redirectStart: 0,
      redirectEnd: 0,
      domainLookupStart: undefined,
      domainLookupEnd: undefined,
      secureConnectionStart: 0,
      connectEnd: 100,
      domInteractive: Number.NaN,
      domContentLoadedEventEnd: 600_001,
      loadEventEnd: 0,
    })
    expect(metric(event({ value: 2550 })).navigation_timing).toEqual({
      schema_version: 1,
      scope: "document",
      ttfb_ms: 2500,
      request_to_first_byte_ms: 2300,
      response_download_ms: 100,
      first_byte_to_lcp_ms: 50,
    })
  })

  it.each([
    { navigationType: "back-forward-cache" },
    { navigationType: "prerender" },
    { navigationStartTime: 8000 },
    { navigationURL: "https://console.superserve.ai/templates/" },
    { $current_url: "https://console.superserve.ai/sandboxes/?view=changed" },
    { $current_url: undefined },
  ])(
    "does not label a different navigation with document timings: %j",
    (override) => {
      useNavigation()
      expect(metric(event(override))).not.toHaveProperty("navigation_timing")
    },
  )

  it("does not attach initial load timings to interaction/layout metrics", () => {
    useNavigation()
    for (const name of ["INP", "CLS"])
      expect(metric(event({}, name), name)).not.toHaveProperty(
        "navigation_timing",
      )
  })

  it("does not reuse a prerendered or different navigation entry", () => {
    useNavigation({ activationStart: 100, navigationId: 2 })
    expect(metric(event())).not.toHaveProperty("navigation_timing")
    vi.mocked(performance.getEntriesByType).mockReturnValue([
      navigation({ navigationId: 2 }),
    ])
    expect(metric(event({ navigationId: 1 }))).not.toHaveProperty(
      "navigation_timing",
    )
  })

  it("removes raw resource/DOM attribution without serializing or mutating it", () => {
    useNavigation()
    const input = event({
      entries: [{ url: "https://example.com/?token=private-entry" }],
      attribution: {
        element: "#private-dom-text",
        navigationEntry: { name: "https://example.com/?code=private-code" },
      },
    })
    const output = enrichWebVitals(input)
    expect(JSON.stringify(output)).not.toMatch(/private-(entry|dom-text|code)/)
    expect(input.properties.$web_vitals_LCP_event.entries).toHaveLength(1)
    expect(
      output?.properties.$web_vitals_LCP_event.navigation_timing,
    ).toMatchObject({ ttfb_ms: 2500 })
  })

  it("keeps metrics usable when Navigation Timing is unsupported", () => {
    vi.spyOn(performance, "getEntriesByType").mockImplementation(() => {
      throw new Error("unsupported")
    })
    expect(metric(event())).toMatchObject({ name: "LCP", value: 5048 })
    expect(metric(event())).not.toHaveProperty("navigation_timing")
    const unrelated = { ...event(), event: "$pageview" }
    expect(enrichWebVitals(unrelated)).toBe(unrelated)
    expect(enrichWebVitals(null)).toBeNull()
  })
})
