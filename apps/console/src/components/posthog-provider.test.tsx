import { afterEach, expect, it, vi } from "vitest"

const TOKEN = "ssinv_use_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v"

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  window.localStorage.clear()
  window.sessionStorage.clear()
  window.history.replaceState(null, "", "/")
})

it("keeps invite tokens out of real PostHog capture and flags requests, including after reload", async () => {
  vi.useFakeTimers()
  window.history.replaceState(null, "", `/invite/${TOKEN}/`)
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "invite-redaction-test")
  const requests: { url: string; body: string }[] = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, options?: RequestInit) => {
      requests.push({ url, body: String(options?.body ?? "") })
      return new Response(
        JSON.stringify({ featureFlags: {}, hasFeatureFlags: true }),
      )
    }),
  )

  const { default: posthog, PostHog } = await import("posthog-js")
  const init = posthog.init.bind(posthog)
  const settings = {
    persistence: "localStorage" as const,
    persistence_name: "invite-redaction-test",
    autocapture: false,
    opt_out_useragent_filter: true,
    capture_pageleave: false,
    disable_external_dependency_loading: true,
    disable_compression: true,
    request_batching: false,
    remote_config_refresh_interval_ms: 0,
  }
  // Keep SDK requests readable and prevent optional scripts from loading.
  vi.spyOn(posthog, "init").mockImplementation((key, config) =>
    init(key, { ...config, ...settings }),
  )
  await import("./posthog-provider")
  await vi.advanceTimersByTimeAsync(20)

  const flagsRequests = () =>
    requests.filter(({ url }) => url.includes("/flags/"))
  expect(flagsRequests()).toHaveLength(1)

  expect(posthog.capture("invite landing")).toMatchObject({
    event: "invite landing",
  })
  expect(posthog.get_property("$initial_person_info")).toMatchObject({
    u: "http://localhost:3000/invite/ssinv_redacted/",
  })
  posthog.reloadFeatureFlags()
  await vi.advanceTimersByTimeAsync(20)

  expect(flagsRequests()).toHaveLength(2)
  expect(
    JSON.parse(flagsRequests()[1].body).person_properties.$initial_current_url,
  ).toBe("http://localhost:3000/invite/ssinv_redacted/")
  expect(requests.some(({ body }) => body.includes("invite landing"))).toBe(
    true,
  )

  window.history.replaceState(null, "", "/sandboxes/")
  vi.spyOn(document, "referrer", "get").mockReturnValue(
    `http://localhost:3000/invite/${TOKEN}/`,
  )
  posthog.unregister("$initial_person_info")
  posthog.capture("after invite")
  posthog.reloadFeatureFlags()
  await vi.advanceTimersByTimeAsync(20)

  expect(flagsRequests()).toHaveLength(3)
  expect(
    JSON.parse(flagsRequests()[2].body).person_properties.$initial_referrer,
  ).toBe("http://localhost:3000/invite/ssinv_redacted/")

  // Existing installations can reload with tokens already saved by the SDK.
  posthog.register({
    $initial_person_info: {
      r: `http://localhost:3000/invite/${TOKEN}/`,
      u: `http://localhost:3000/invite/${TOKEN}/`,
    },
    $initial_referrer_info: { $referrer: `/invite/${TOKEN}/` },
    $initial_campaign_params: { utm_content: TOKEN },
  })
  const storageKey = "ph_invite-redaction-test"
  expect(window.localStorage.getItem(storageKey)).toContain(TOKEN)

  const reloaded = new PostHog()
  reloaded.init("invite-redaction-test", {
    ...settings,
    api_host: "/ingest",
    person_profiles: "always",
    capture_pageview: false,
    loaded: posthog.config.loaded,
  })
  await vi.advanceTimersByTimeAsync(20)

  expect(flagsRequests()).toHaveLength(4)
  expect(
    JSON.parse(flagsRequests()[3].body).person_properties.$initial_current_url,
  ).toBe("http://localhost:3000/invite/ssinv_redacted/")
  const persisted = JSON.parse(window.localStorage.getItem(storageKey) ?? "{}")
  for (const key of [
    "$initial_person_info",
    "$initial_referrer_info",
    "$initial_campaign_params",
  ]) {
    expect(persisted[key]).toBeDefined()
    expect(JSON.stringify(persisted[key])).not.toContain(TOKEN)
  }
  for (const { body } of requests) {
    expect(body).not.toContain(TOKEN)
  }
})
