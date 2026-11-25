import type { CaptureResult } from "posthog-js"

const MAX_TIMING_MS = 600_000
const LOAD_METRICS = new Set(["FCP", "LCP"])

interface DocumentNavigationTiming extends PerformanceNavigationTiming {
  activationStart?: number
  navigationId?: number | string
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function timing(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= MAX_TIMING_MS
  )
}

function sameDocument(left: unknown, right: unknown): boolean {
  if (typeof left !== "string" || typeof right !== "string") return false
  try {
    const a = new URL(left)
    const b = new URL(right)
    return (
      a.origin === b.origin &&
      a.pathname === b.pathname &&
      a.search === b.search
    )
  } catch {
    return false
  }
}

function navigationTimings(
  metric: Record<string, unknown>,
  name: string,
  navigation: DocumentNavigationTiming,
): Record<string, number | string> | undefined {
  if (
    !LOAD_METRICS.has(name) ||
    !["navigate", "reload", "back-forward"].includes(
      metric.navigationType as string,
    ) ||
    metric.navigationType !== navigation.type.replaceAll("_", "-") ||
    (metric.navigationStartTime !== undefined &&
      metric.navigationStartTime !== 0) ||
    (navigation.activationStart ?? 0) > 0 ||
    (metric.navigationId !== undefined &&
      navigation.navigationId !== undefined &&
      metric.navigationId !== navigation.navigationId) ||
    !sameDocument(metric.navigationURL ?? metric.$current_url, navigation.name)
  )
    return undefined

  const result: Record<string, number | string> = {
    schema_version: 1,
    scope: "document",
  }
  const duration = (
    key: string,
    start: unknown,
    end: unknown,
    startsAtNavigation = false,
  ) => {
    // Zero means unavailable for many native timing fields (including hidden
    // cross-origin redirects), unless it is the document's navigation start.
    if (
      timing(start) &&
      timing(end) &&
      (start > 0 || startsAtNavigation) &&
      end > 0 &&
      end >= start
    )
      result[key] = Math.round((end - start) * 100) / 100
  }

  duration("ttfb_ms", navigation.startTime, navigation.responseStart, true)
  duration("redirect_ms", navigation.redirectStart, navigation.redirectEnd)
  duration("dns_ms", navigation.domainLookupStart, navigation.domainLookupEnd)
  duration("connection_ms", navigation.connectStart, navigation.connectEnd)
  duration("tls_ms", navigation.secureConnectionStart, navigation.connectEnd)
  duration(
    "request_to_first_byte_ms",
    navigation.requestStart,
    navigation.responseStart,
  )
  duration(
    "response_download_ms",
    navigation.responseStart,
    navigation.responseEnd,
  )
  duration(
    "dom_interactive_ms",
    navigation.startTime,
    navigation.domInteractive,
    true,
  )
  duration(
    "dom_content_loaded_ms",
    navigation.startTime,
    navigation.domContentLoadedEventEnd,
    true,
  )
  duration(
    "document_load_ms",
    navigation.startTime,
    navigation.loadEventEnd,
    true,
  )
  duration(
    `first_byte_to_${name.toLowerCase()}_ms`,
    navigation.responseStart,
    metric.value,
  )
  if (name === "LCP")
    duration("response_end_to_lcp_ms", navigation.responseEnd, metric.value)

  return Object.keys(result).length > 2 ? result : undefined
}

/** Enrich existing load metrics without extra requests or retained DOM nodes. */
export function enrichWebVitals(
  event: CaptureResult | null,
): CaptureResult | null {
  if (!event || event.event !== "$web_vitals") return event

  let navigation: DocumentNavigationTiming | undefined
  try {
    navigation = performance.getEntriesByType("navigation")[0] as
      | DocumentNavigationTiming
      | undefined
  } catch {
    // Browsers without Navigation Timing still send their existing metrics.
  }

  const properties = { ...event.properties }
  for (const name of ["FCP", "LCP", "CLS", "INP"]) {
    const key = `$web_vitals_${name}_event`
    const metric = record(properties[key])
    if (!metric) continue
    const safeMetric = { ...metric }
    // Native entries have already lost their getters in the SDK's copy step.
    // Raw entries/attribution can otherwise carry resource URLs or DOM text.
    delete safeMetric.entries
    delete safeMetric.attribution
    delete safeMetric.navigation_timing
    if (navigation) {
      try {
        const timings = navigationTimings(metric, name, navigation)
        if (timings) safeMetric.navigation_timing = timings
      } catch {
        // Diagnostics must never prevent the original event from being sent.
      }
    }
    properties[key] = safeMetric
  }
  return { ...event, properties }
}
