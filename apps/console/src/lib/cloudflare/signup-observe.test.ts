import { afterEach, describe, expect, it, vi } from "vitest"

const mockRpc = vi.hoisted(() => vi.fn())
const mockTrackEvent = vi.hoisted(() => vi.fn())
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({ rpc: mockRpc })),
}))
vi.mock("@/lib/posthog/actions", () => ({ trackEvent: mockTrackEvent }))
vi.mock("@/lib/posthog/events", () => ({
  AUTH_EVENTS: {
    CLOUDFLARE_SIGNUP_OBSERVED: "auth_cloudflare_signup_observed",
    CLOUDFLARE_SIGNUP_OBSERVATION_FAILED:
      "auth_cloudflare_signup_observation_failed",
  },
}))

import { observeCloudflareSignup } from "./signup-observe"

afterEach(() => {
  vi.restoreAllMocks()
  mockRpc.mockReset()
  mockTrackEvent.mockReset()
  delete process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY
  delete process.env.CLOUDFLARE_SIGNUP_CONFIG_VERSION
  delete process.env.CLOUDFLARE_SIGNUP_CAPABILITIES
})

describe("observeCloudflareSignup", () => {
  it("fails open when disabled", async () => {
    mockRpc.mockResolvedValue({ data: false, error: null })
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    await expect(
      observeCloudflareSignup({ signupAttemptId: "a", signupMethod: "email" }),
    ).resolves.toBeUndefined()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(mockTrackEvent).not.toHaveBeenCalled()
  })

  it("records flag lookup failures", async () => {
    mockRpc.mockResolvedValue({ data: null, error: new Error("down") })
    await observeCloudflareSignup({
      signupAttemptId: "a",
      signupMethod: "email",
    })
    expect(mockTrackEvent).toHaveBeenCalledWith(
      "auth_cloudflare_signup_observation_failed",
      "a",
      expect.objectContaining({
        provider_outcome: "configuration_lookup_failed",
      }),
    )
  })

  it("verifies a Turnstile token and persists Free Siteverify fields", async () => {
    process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY = "secret"
    process.env.CLOUDFLARE_SIGNUP_CONFIG_VERSION = "free-v1"
    const logSpy = vi.spyOn(console, "info").mockImplementation(() => {})
    mockRpc.mockResolvedValue({ data: true, error: null })
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          event_id: "event-1",
          challenge_ts: "2026-09-02T00:00:00Z",
          hostname: "console.superserve.ai",
          action: "signup",
          cdata: "experiment",
          metadata: { ephemeral_id: "enterprise-later" },
        }),
      ),
    )
    await observeCloudflareSignup({
      signupAttemptId: "attempt-1",
      signupMethod: "google",
      turnstileToken: "token-secret",
    })
    expect(mockTrackEvent).toHaveBeenCalledWith(
      "auth_cloudflare_signup_observed",
      "attempt-1",
      expect.objectContaining({
        success: true,
        provider_request_id: "event-1",
        challenge_timestamp: "2026-09-02T00:00:00Z",
        action: "signup",
        hostname: "console.superserve.ai",
        ephemeral_id: "enterprise-later",
        provider_outcome: "success",
      }),
    )
    expect(JSON.stringify(mockTrackEvent.mock.calls)).not.toContain(
      "token-secret",
    )
    expect(logSpy).toHaveBeenCalledWith(
      "Cloudflare signup observation outcome",
      expect.objectContaining({
        signup_attempt_id: "attempt-1",
        provider_outcome: "success",
        success: true,
        ephemeral_id_status: "success",
        provider_latency_ms: expect.any(Number),
      }),
    )
    expect(JSON.stringify(logSpy.mock.calls)).not.toContain("token-secret")
  })

  it("records provider rejection and error codes without blocking signup", async () => {
    process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY = "secret"
    mockRpc.mockResolvedValue({ data: true, error: null })
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          success: false,
          "error-codes": ["timeout-or-duplicate"],
        }),
      ),
    )
    await expect(
      observeCloudflareSignup({
        signupAttemptId: "a",
        signupMethod: "email",
        turnstileToken: "t",
      }),
    ).resolves.toBeUndefined()
    expect(mockTrackEvent).toHaveBeenCalledWith(
      "auth_cloudflare_signup_observed",
      "a",
      expect.objectContaining({
        provider_outcome: "rejected",
        error_codes: ["timeout-or-duplicate"],
      }),
    )
  })

  it("separates provider/configuration errors from visitor rejection", async () => {
    process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY = "secret"
    mockRpc.mockResolvedValue({ data: true, error: null })
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          success: false,
          "error-codes": ["invalid-input-secret"],
        }),
      ),
    )
    await observeCloudflareSignup({
      signupAttemptId: "a",
      signupMethod: "email",
      turnstileToken: "t",
    })
    expect(mockTrackEvent).toHaveBeenCalledWith(
      "auth_cloudflare_signup_observed",
      "a",
      expect.objectContaining({ provider_outcome: "provider_error" }),
    )
  })

  it.each([
    ["turnstile_free", undefined, "not_active", false],
    ["turnstile_free,ephemeral_id", undefined, "missing_expected_signal", true],
    ["turnstile_free, ephemeral_id", "native-id", "success", true],
    ["turnstile_free", "native-id", "success", false],
    ["turnstile_free,ephemeral_id", null, "missing_expected_signal", true],
    ["turnstile_free,ephemeral_id", "", "malformed_response", true],
    [
      "turnstile_free,ephemeral_id",
      { token: "private" },
      "malformed_response",
      true,
    ],
  ])(
    "classifies capability %s and ID %j as %s",
    async (capabilities, id, status, expected) => {
      process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY = "secret-value"
      process.env.CLOUDFLARE_SIGNUP_CAPABILITIES = capabilities
      process.env.CLOUDFLARE_SIGNUP_CONFIG_VERSION = "ss-560-ephemeral-v1"
      mockRpc.mockResolvedValue({ data: true, error: null })
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            request_id: "request-1",
            metadata: { ephemeral_id: id },
            token: "challenge-private",
            arbitrary_field: "private",
          }),
        ),
      )
      const logSpy = vi.spyOn(console, "info").mockImplementation(() => {})
      await expect(
        observeCloudflareSignup({
          signupAttemptId: "attempt-1",
          signupMethod: "email",
          userId: "user-1",
          teamId: "team-1",
          turnstileToken: "challenge-private",
        }),
      ).resolves.toBeUndefined()
      expect(mockTrackEvent).toHaveBeenCalledWith(
        "auth_cloudflare_signup_observed",
        "user-1",
        expect.objectContaining({
          provider: "cloudflare",
          signup_attempt_id: "attempt-1",
          superserve_user_id: "user-1",
          team_id: "team-1",
          provider_request_id: "request-1",
          provider_outcome: "success",
          ephemeral_id: typeof id === "string" && id ? id : null,
          ephemeral_id_present: typeof id === "string" && !!id,
          ephemeral_id_expected: expected,
          ephemeral_id_status: status,
          capabilities: capabilities.split(",").map((value) => value.trim()),
          config_version: "ss-560-ephemeral-v1",
          provider_latency_ms: expect.any(Number),
          observed_at: expect.any(String),
        }),
      )
      const persisted = JSON.stringify([
        mockTrackEvent.mock.calls,
        logSpy.mock.calls,
      ])
      expect(persisted).not.toContain("private")
      expect(persisted).not.toContain("secret-value")
    },
  )

  describe.each(["turnstile_free", "ephemeral_id"])(
    "metadata shape with capability %s",
    (capabilities) => {
      it.each([
        ["omitted", undefined, false],
        ["empty object", {}, false],
        ["null", null, true],
        ["string", "private-metadata", true],
        ["number", 42, true],
        ["boolean", false, true],
        ["array", ["private-metadata"], true],
      ])("classifies %s metadata", async (_label, metadata, malformed) => {
        process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY = "secret"
        process.env.CLOUDFLARE_SIGNUP_CAPABILITIES = capabilities
        mockRpc.mockResolvedValue({ data: true, error: null })
        vi.spyOn(globalThis, "fetch").mockResolvedValue(
          new Response(JSON.stringify({ success: true, metadata })),
        )
        const logSpy = vi.spyOn(console, "info").mockImplementation(() => {})
        const status = malformed
          ? "malformed_response"
          : capabilities === "ephemeral_id"
            ? "missing_expected_signal"
            : "not_active"

        await expect(
          observeCloudflareSignup({
            signupAttemptId: "a",
            signupMethod: "email",
            turnstileToken: "t",
          }),
        ).resolves.toBeUndefined()
        expect(mockTrackEvent).toHaveBeenCalledWith(
          "auth_cloudflare_signup_observed",
          "a",
          expect.objectContaining({
            provider_outcome: "success",
            ephemeral_id_status: status,
            ephemeral_id: null,
            ephemeral_id_present: false,
          }),
        )
        expect(logSpy).toHaveBeenCalledWith(
          "Cloudflare signup observation outcome",
          expect.objectContaining({ ephemeral_id_status: status }),
        )
        expect(
          JSON.stringify([mockTrackEvent.mock.calls, logSpy.mock.calls]),
        ).not.toContain("private-metadata")
      })
    },
  )

  it.each([
    ["invalid JSON", "not-json", 200, "malformed"],
    ["array response", "[]", 200, "malformed"],
    ["missing success", "{}", 200, "malformed"],
    ["invalid success", '{"success":"true"}', 200, "malformed"],
    ["unentitled", "{}", 403, "http_403"],
    [
      "provider failure",
      '{"success":false,"error-codes":["internal-error"]}',
      200,
      "provider_error",
    ],
  ])(
    "fails open with active capability after %s",
    async (_label, body, status, outcome) => {
      process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY = "secret"
      process.env.CLOUDFLARE_SIGNUP_CAPABILITIES = "ephemeral_id"
      mockRpc.mockResolvedValue({ data: true, error: null })
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(body, { status }),
      )
      await expect(
        observeCloudflareSignup({
          signupAttemptId: "a",
          signupMethod: "google",
          turnstileToken: "t",
        }),
      ).resolves.toBeUndefined()
      expect(mockTrackEvent).toHaveBeenCalledWith(
        "auth_cloudflare_signup_observed",
        "a",
        expect.objectContaining({
          provider_outcome: outcome,
          ephemeral_id_status: "unavailable",
          ephemeral_id_present: false,
        }),
      )
    },
  )

  it.each(["timeout", "error"])(
    "fails open on transport %s",
    async (outcome) => {
      process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY = "secret"
      mockRpc.mockResolvedValue({ data: true, error: null })
      const error = new Error("sensitive transport details")
      if (outcome === "timeout") error.name = "TimeoutError"
      vi.spyOn(globalThis, "fetch").mockRejectedValue(error)
      await expect(
        observeCloudflareSignup({
          signupAttemptId: "a",
          signupMethod: "email",
          turnstileToken: "t",
        }),
      ).resolves.toBeUndefined()
      expect(mockTrackEvent).toHaveBeenCalledWith(
        "auth_cloudflare_signup_observed",
        "a",
        expect.objectContaining({ provider_outcome: outcome }),
      )
      expect(JSON.stringify(mockTrackEvent.mock.calls)).not.toContain(
        error.message,
      )
    },
  )

  it.each(["unconfigured", "missing_token"])(
    "fails open when %s",
    async (outcome) => {
      if (outcome === "missing_token")
        process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY = "secret"
      mockRpc.mockResolvedValue({ data: true, error: null })
      const fetchSpy = vi.spyOn(globalThis, "fetch")
      await expect(
        observeCloudflareSignup({
          signupAttemptId: "a",
          signupMethod: "email",
        }),
      ).resolves.toBeUndefined()
      expect(fetchSpy).not.toHaveBeenCalled()
      expect(mockTrackEvent).toHaveBeenCalledWith(
        "auth_cloudflare_signup_observed",
        "a",
        expect.objectContaining({ provider_outcome: outcome }),
      )
    },
  )

  it.each([true, null])(
    "contains telemetry write failures with flag state %s",
    async (enabled) => {
      mockRpc.mockResolvedValue({
        data: enabled,
        error: enabled === null ? new Error("down") : null,
      })
      mockTrackEvent.mockRejectedValue(new Error("telemetry unavailable"))
      await expect(
        observeCloudflareSignup({
          signupAttemptId: "a",
          signupMethod: "email",
        }),
      ).resolves.toBeUndefined()
      expect(mockTrackEvent).toHaveBeenCalledTimes(1)
    },
  )
})
