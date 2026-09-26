import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("next/server", () => ({
  after: vi.fn(),
}))

vi.mock("@/lib/posthog/actions", () => ({
  trackEvent: vi.fn(),
}))

import { after } from "next/server"

import { trackEvent } from "@/lib/posthog/actions"

import { observeFingerprintSignup, resolveFingerprintSignup } from "./observe"

const originalSecret = process.env.FINGERPRINT_SECRET_API_KEY

afterEach(() => {
  vi.restoreAllMocks()
  vi.mocked(after).mockReset()
  vi.mocked(trackEvent).mockReset()
  if (originalSecret === undefined) {
    delete process.env.FINGERPRINT_SECRET_API_KEY
  } else {
    process.env.FINGERPRINT_SECRET_API_KEY = originalSecret
  }
})

describe("observeFingerprintSignup", () => {
  it("is a no-op when Fingerprint is not configured", async () => {
    delete process.env.FINGERPRINT_SECRET_API_KEY
    const fetchSpy = vi.spyOn(globalThis, "fetch")

    await expect(
      observeFingerprintSignup({ eventId: "event-1", signupMethod: "email" }),
    ).resolves.toBeUndefined()

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(trackEvent).not.toHaveBeenCalled()
  })

  it("fails open when the Server API request fails", async () => {
    process.env.FINGERPRINT_SECRET_API_KEY = "server-secret"
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"))

    await expect(
      observeFingerprintSignup({ eventId: "event-1", signupMethod: "google" }),
    ).resolves.toBeUndefined()

    expect(trackEvent).not.toHaveBeenCalled()
  })

  it("fails open after 1500 ms when the Server API request stalls", async () => {
    process.env.FINGERPRINT_SECRET_API_KEY = "server-secret"
    vi.useFakeTimers()

    try {
      const timeoutSpy = vi
        .spyOn(AbortSignal, "timeout")
        .mockImplementation((milliseconds) => {
          const controller = new AbortController()
          setTimeout(() => controller.abort(), milliseconds)
          return controller.signal
        })
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
        (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            const signal = init?.signal
            signal?.addEventListener("abort", () => reject(signal?.reason), {
              once: true,
            })
          }),
      )

      const result = resolveFingerprintSignup({
        eventId: "event-1",
        signupMethod: "email",
      })
      let settled = false
      void result.then(() => {
        settled = true
      })

      expect(timeoutSpy).toHaveBeenCalledWith(1500)
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://api.fpjs.io/v4/events/event-1",
        expect.objectContaining({ signal: timeoutSpy.mock.results[0]?.value }),
      )
      await vi.advanceTimersByTimeAsync(1499)
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(1)

      await expect(result).resolves.toBeNull()
      expect(after).not.toHaveBeenCalled()
      expect(trackEvent).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it("keeps provider-failure warnings free of Fingerprint identifiers", async () => {
    process.env.FINGERPRINT_SECRET_API_KEY = "server-secret"
    const eventId = "sensitive-event-id"
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            event_id: "different-event-id",
            identification: { visitor_id: "sensitive-visitor-id" },
          }),
        ),
      )
      .mockRejectedValueOnce(new Error(`request for ${eventId} failed`))

    for (let index = 0; index < 3; index++) {
      await expect(
        resolveFingerprintSignup({ eventId, signupMethod: "email" }),
      ).resolves.toBeNull()
    }

    expect(warn.mock.calls).toEqual([
      ["Fingerprint observation lookup failed", { status: 503 }],
      ["Fingerprint observation response was malformed"],
      ["Fingerprint observation failed open"],
    ])
    expect(after).not.toHaveBeenCalled()
  })

  it("records trusted server-side v4 identification data", async () => {
    process.env.FINGERPRINT_SECRET_API_KEY = "server-secret"
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          event_id: "event-1",
          identification: {
            visitor_id: "visitor-1",
            visitor_found: true,
            confidence: 0.99,
          },
          vpn: true,
          vpn_confidence: "high",
          vpn_methods: { public_vpn: true, relay: false },
          proxy: true,
          proxy_details: { proxy_type: "residential" },
          ip_blocklist: { tor_node: false, attack_source: false },
          high_activity_device: true,
          tampering: false,
          developer_tools: true,
          virtual_machine: false,
          virtual_machine_ml_score: 0.12,
          incognito: false,
          privacy_settings: true,
          rare_device: true,
          rare_device_percentile_bucket: "p99.9+",
          bot: "not_detected",
          velocity: {
            distinct_ip: { "5_minutes": 2, "1_hour": 4, "24_hours": 8 },
            distinct_country: { "5_minutes": 1, "1_hour": 2, "24_hours": 3 },
            events: { "5_minutes": 3, "1_hour": 5, "24_hours": 9 },
            ip_events: { "5_minutes": 2, "1_hour": 6, "24_hours": 10 },
          },
        }),
        { status: 200 },
      ),
    )

    await observeFingerprintSignup({
      eventId: "event-1",
      userId: "user-1",
      signupMethod: "email",
    })

    expect(fetch).toHaveBeenCalledWith(
      "https://api.fpjs.io/v4/events/event-1",
      expect.objectContaining({
        headers: { Authorization: "Bearer server-secret" },
      }),
    )
    expect(trackEvent).not.toHaveBeenCalled()
    expect(after).toHaveBeenCalledTimes(1)
    const task = vi.mocked(after).mock.calls[0]?.[0]
    if (typeof task !== "function")
      throw new Error("Expected an after callback")
    await task()

    expect(trackEvent).toHaveBeenCalledWith(
      "auth_fingerprint_signup_observed",
      "user-1",
      expect.objectContaining({
        provider: "fingerprint",
        provider_event_id: "event-1",
        visitor_id: "visitor-1",
        visitor_found: true,
        confidence_score: 0.99,
        vpn: true,
        smart_signals: expect.objectContaining({
          vpn: true,
          proxy: true,
          high_activity_device: true,
          tampering: false,
          developer_tools: true,
          virtual_machine: false,
          virtual_machine_ml_score: 0.12,
          bot: "not_detected",
          incognito: false,
          privacy_settings: true,
          rare_device: true,
          rare_device_percentile_bucket: "p99.9+",
          geolocation_spoofing: null,
          velocity: {
            distinct_ip: { "5m": 2, "1h": 4, "24h": 8 },
            distinct_country: { "5m": 1, "1h": 2, "24h": 3 },
            events: { "5m": 3, "1h": 5, "24h": 9 },
            ip_events: { "5m": 2, "1h": 6, "24h": 10 },
          },
        }),
        superserve_user_id: "user-1",
      }),
    )
  })

  it("returns the verified visitor while observation telemetry is pending", async () => {
    process.env.FINGERPRINT_SECRET_API_KEY = "server-secret"
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          event_id: "event-1",
          identification: { visitor_id: "VisitorCase" },
        }),
        { status: 200 },
      ),
    )
    vi.mocked(trackEvent).mockImplementation(() => new Promise(() => {}))
    vi.mocked(after).mockImplementation((task) => {
      if (typeof task === "function") void task()
    })

    await expect(
      resolveFingerprintSignup({ eventId: "event-1", signupMethod: "email" }),
    ).resolves.toBe("VisitorCase")
    expect(after).toHaveBeenCalledTimes(1)
    expect(trackEvent).toHaveBeenCalledTimes(1)
  })

  it("keeps the verified visitor when observation cannot be scheduled", async () => {
    process.env.FINGERPRINT_SECRET_API_KEY = "server-secret"
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          event_id: "event-1",
          identification: { visitor_id: "VisitorCase" },
        }),
        { status: 200 },
      ),
    )
    vi.mocked(after).mockImplementation(() => {
      throw new Error("request context unavailable")
    })

    await expect(
      resolveFingerprintSignup({ eventId: "event-1", signupMethod: "email" }),
    ).resolves.toBe("VisitorCase")
    expect(trackEvent).not.toHaveBeenCalled()
  })

  it("keeps the verified visitor when observation telemetry rejects", async () => {
    process.env.FINGERPRINT_SECRET_API_KEY = "server-secret"
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          event_id: "event-1",
          identification: { visitor_id: "VisitorCase" },
        }),
        { status: 200 },
      ),
    )
    vi.mocked(trackEvent).mockRejectedValue(new Error("telemetry unavailable"))

    await expect(
      resolveFingerprintSignup({ eventId: "event-1", signupMethod: "email" }),
    ).resolves.toBe("VisitorCase")
    const task = vi.mocked(after).mock.calls[0]?.[0]
    if (typeof task !== "function")
      throw new Error("Expected an after callback")
    await expect(task()).resolves.toBeUndefined()
    expect(trackEvent).toHaveBeenCalledTimes(1)
  })

  it("rejects a provider event ID mismatch even with a visitor ID", async () => {
    process.env.FINGERPRINT_SECRET_API_KEY = "server-secret"
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          event_id: "other-event",
          identification: { visitor_id: "VisitorCase" },
          vpn: true,
        }),
        { status: 200 },
      ),
    )

    await expect(
      resolveFingerprintSignup({ eventId: "event-1", signupMethod: "email" }),
    ).resolves.toBeNull()

    expect(after).not.toHaveBeenCalled()
    expect(trackEvent).not.toHaveBeenCalled()
  })

  it("fails open when the server response has no visitor ID", async () => {
    process.env.FINGERPRINT_SECRET_API_KEY = "server-secret"
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ event_id: "event-1", identification: {} }),
        { status: 200 },
      ),
    )

    await expect(
      resolveFingerprintSignup({ eventId: "event-1", signupMethod: "email" }),
    ).resolves.toBeNull()
    expect(after).not.toHaveBeenCalled()
  })
})
