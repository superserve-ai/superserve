import { afterEach, describe, expect, it, vi } from "vitest"

const mockRpc = vi.hoisted(() => vi.fn())
const mockTrackEvent = vi.hoisted(() => vi.fn())
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    rpc: mockRpc,
  })),
}))

vi.mock("@/lib/posthog/actions", () => ({ trackEvent: mockTrackEvent }))
vi.mock("@/lib/posthog/events", () => ({
  AUTH_EVENTS: {
    CLOUDFLARE_SIGNUP_OBSERVED: "auth_cloudflare_signup_observed",
    CLOUDFLARE_SIGNUP_OBSERVATION_FAILED:
      "auth_cloudflare_signup_observation_failed",
  },
}))
import { trackEvent } from "@/lib/posthog/actions"

import { observeCloudflareSignup } from "./signup-observe"

const original = {
  url: process.env.CLOUDFLARE_SIGNUP_OBSERVATION_URL,
  secret: process.env.CLOUDFLARE_SIGNUP_OBSERVATION_SECRET,
  configVersion: process.env.CLOUDFLARE_SIGNUP_CONFIG_VERSION,
  capabilities: process.env.CLOUDFLARE_SIGNUP_CAPABILITIES,
}

afterEach(() => {
  vi.restoreAllMocks()
  mockTrackEvent.mockClear()
  mockRpc.mockReset()
  for (const [env, value] of [
    ["CLOUDFLARE_SIGNUP_OBSERVATION_URL", original.url],
    ["CLOUDFLARE_SIGNUP_OBSERVATION_SECRET", original.secret],
    ["CLOUDFLARE_SIGNUP_CONFIG_VERSION", original.configVersion],
    ["CLOUDFLARE_SIGNUP_CAPABILITIES", original.capabilities],
  ] as const) {
    if (value === undefined) delete process.env[env]
    else process.env[env] = value
  }
})

describe("observeCloudflareSignup", () => {
  it("is disabled and fail-open when unconfigured", async () => {
    await expect(
      observeCloudflareSignup({ signupAttemptId: "a", signupMethod: "email" }),
    ).resolves.toBeUndefined()
    expect(mockRpc).not.toHaveBeenCalled()
    expect(trackEvent).not.toHaveBeenCalled()
  })

  it("respects the runtime feature flag and skips fetch when disabled", async () => {
    process.env.CLOUDFLARE_SIGNUP_OBSERVATION_URL = "https://cf.test/observe"
    process.env.CLOUDFLARE_SIGNUP_OBSERVATION_SECRET = "secret"
    mockRpc.mockResolvedValue({ data: false, error: null })
    const fetchSpy = vi.spyOn(globalThis, "fetch")

    await expect(
      observeCloudflareSignup({
        signupAttemptId: "attempt-0",
        signupMethod: "email",
      }),
    ).resolves.toBeUndefined()

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(trackEvent).not.toHaveBeenCalled()
  })

  it("records flag lookup failures while failing open", async () => {
    process.env.CLOUDFLARE_SIGNUP_OBSERVATION_URL = "https://cf.test/observe"
    process.env.CLOUDFLARE_SIGNUP_OBSERVATION_SECRET = "secret"
    mockRpc.mockResolvedValue({ data: null, error: new Error("rpc down") })
    const fetchSpy = vi.spyOn(globalThis, "fetch")

    await expect(
      observeCloudflareSignup({
        signupAttemptId: "attempt-flag-error",
        signupMethod: "email",
      }),
    ).resolves.toBeUndefined()

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(trackEvent).toHaveBeenCalledWith(
      "auth_cloudflare_signup_observation_failed",
      "attempt-flag-error",
      expect.objectContaining({
        provider_outcome: "configuration_lookup_failed",
      }),
    )
  })

  it("records bounded, secret-safe provider observations", async () => {
    process.env.CLOUDFLARE_SIGNUP_OBSERVATION_URL = "https://cf.test/observe"
    process.env.CLOUDFLARE_SIGNUP_OBSERVATION_SECRET = "secret"
    process.env.CLOUDFLARE_SIGNUP_CONFIG_VERSION = "v2"
    process.env.CLOUDFLARE_SIGNUP_CAPABILITIES = "ephemeral_ids,account_abuse"
    mockRpc.mockResolvedValue({ data: true, error: null })
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          event_id: "evt",
          request_id: "req",
          ephemeral_id: "ephemeral",
          account_abuse_verdict: "suspicious",
          secret: "do-not-store",
          signals: { automation: true },
        }),
        { status: 200 },
      ),
    )

    await observeCloudflareSignup({
      signupAttemptId: "attempt-1",
      signupMethod: "google",
      userId: "user-1",
    })

    expect(trackEvent).toHaveBeenCalledWith(
      "auth_cloudflare_signup_observed",
      "user-1",
      expect.objectContaining({
        signup_attempt_id: "attempt-1",
        provider_event_id: "evt",
        provider_request_id: "req",
        ephemeral_id: "ephemeral",
        account_abuse_verdict: "suspicious",
        capabilities: ["ephemeral_ids", "account_abuse"],
        config_version: "v2",
        provider_outcome: "success",
        signals: { automation: true },
      }),
    )
    expect(JSON.stringify(mockTrackEvent.mock.calls[0])).not.toContain(
      "do-not-store",
    )
  })

  it("marks 404 entitlement responses as feature_not_entitled", async () => {
    process.env.CLOUDFLARE_SIGNUP_OBSERVATION_URL = "https://cf.test/observe"
    process.env.CLOUDFLARE_SIGNUP_OBSERVATION_SECRET = "secret"
    mockRpc.mockResolvedValue({ data: true, error: null })
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("", { status: 404 }),
    )

    await observeCloudflareSignup({
      signupAttemptId: "attempt-2",
      signupMethod: "email",
    })

    expect(trackEvent).toHaveBeenCalledWith(
      "auth_cloudflare_signup_observed",
      "attempt-2",
      expect.objectContaining({
        provider_outcome: "feature_not_entitled",
      }),
    )
  })

  it("marks malformed payloads as malformed", async () => {
    process.env.CLOUDFLARE_SIGNUP_OBSERVATION_URL = "https://cf.test/observe"
    process.env.CLOUDFLARE_SIGNUP_OBSERVATION_SECRET = "secret"
    mockRpc.mockResolvedValue({ data: true, error: null })
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("not-json", { status: 200 }),
    )

    await observeCloudflareSignup({
      signupAttemptId: "attempt-3",
      signupMethod: "google",
    })

    expect(trackEvent).toHaveBeenCalledWith(
      "auth_cloudflare_signup_observed",
      "attempt-3",
      expect.objectContaining({
        provider_outcome: "malformed",
      }),
    )
  })

  it("marks timeouts as timeout", async () => {
    process.env.CLOUDFLARE_SIGNUP_OBSERVATION_URL = "https://cf.test/observe"
    process.env.CLOUDFLARE_SIGNUP_OBSERVATION_SECRET = "secret"
    mockRpc.mockResolvedValue({ data: true, error: null })
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      Object.assign(new Error("timed out"), { name: "TimeoutError" }),
    )

    await observeCloudflareSignup({
      signupAttemptId: "attempt-4",
      signupMethod: "email",
    })

    expect(trackEvent).toHaveBeenCalledWith(
      "auth_cloudflare_signup_observed",
      "attempt-4",
      expect.objectContaining({
        provider_outcome: "timeout",
      }),
    )
  })
})
