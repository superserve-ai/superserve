/**
 * verifyRecaptcha — the server-side gate on signup.
 *
 * Tests exercise the configured path (all three env vars set), which the
 * signup action/page tests don't cover since they run without reCAPTCHA
 * configured and only prove the unconfigured fail-open behavior.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const fetchSpy = vi.fn()
vi.stubGlobal("fetch", fetchSpy)

import { verifyRecaptcha } from "./verify"

const ORIGINAL_ENV = {
  RECAPTCHA_API_KEY: process.env.RECAPTCHA_API_KEY,
  RECAPTCHA_PROJECT_ID: process.env.RECAPTCHA_PROJECT_ID,
  NEXT_PUBLIC_RECAPTCHA_SITE_KEY: process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY,
  RECAPTCHA_SCORE_THRESHOLD: process.env.RECAPTCHA_SCORE_THRESHOLD,
}

function restoreEnv() {
  for (const [name, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
}

function configure() {
  process.env.RECAPTCHA_API_KEY = "test-api-key"
  process.env.RECAPTCHA_PROJECT_ID = "test-project"
  process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY = "test-site-key"
}

function okResponse(body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status: 200 })
}

describe("verifyRecaptcha (unconfigured)", () => {
  let clock = Date.UTC(2026, 0, 1)
  let errorSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    delete process.env.RECAPTCHA_API_KEY
    delete process.env.RECAPTCHA_PROJECT_ID
    delete process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY
    // Outside production unless a test says otherwise, whatever the shell has.
    vi.stubEnv("VERCEL_ENV", "")
    vi.stubEnv("NODE_ENV", "test")
    // The missing-keys log is throttled per server instance; start each test
    // well past the previous one's log.
    vi.useFakeTimers({ toFake: ["Date"] })
    clock += 60 * 60_000
    vi.setSystemTime(clock)
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    errorSpy.mockRestore()
    vi.useRealTimers()
    vi.unstubAllEnvs()
    restoreEnv()
    fetchSpy.mockReset()
  })

  it("fails open outside production without calling the assessment API or logging", async () => {
    const result = await verifyRecaptcha("some-token", "signup")
    expect(result).toEqual({
      verified: true,
      providerOutcome: "unconfigured",
    })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it.each([
    ["Vercel production", { VERCEL_ENV: "production", NODE_ENV: "production" }],
    ["a production build outside Vercel", { NODE_ENV: "production" }],
  ])(
    "fails open in %s but logs that the keys are missing",
    async (_label, env) => {
      for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value)

      await expect(verifyRecaptcha("some-token", "signup")).resolves.toEqual({
        verified: true,
        providerOutcome: "unconfigured",
      })
      expect(fetchSpy).not.toHaveBeenCalled()
      expect(errorSpy).toHaveBeenCalledTimes(1)
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("reCAPTCHA is not configured in production"),
      )
    },
  )

  it("logs the missing keys at most once a minute", async () => {
    vi.stubEnv("VERCEL_ENV", "production")

    await verifyRecaptcha("some-token", "signup")
    vi.setSystemTime(clock + 59_000)
    await verifyRecaptcha("some-token", "signup")
    expect(errorSpy).toHaveBeenCalledTimes(1)

    vi.setSystemTime(clock + 60_000)
    await verifyRecaptcha("some-token", "signup")
    expect(errorSpy).toHaveBeenCalledTimes(2)
  })

  it.each(["preview", "development"])(
    "does not log on a Vercel %s deployment",
    async (vercelEnv) => {
      vi.stubEnv("NODE_ENV", "production")
      vi.stubEnv("VERCEL_ENV", vercelEnv)

      await expect(verifyRecaptcha("some-token", "signup")).resolves.toEqual({
        verified: true,
        providerOutcome: "unconfigured",
      })
      expect(errorSpy).not.toHaveBeenCalled()
    },
  )

  it("fails closed when reCAPTCHA is only partially configured", async () => {
    process.env.RECAPTCHA_API_KEY = "test-api-key"
    const result = await verifyRecaptcha(undefined, "signup")
    expect(result).toEqual({
      verified: false,
      providerOutcome: "configuration_error",
      reason: "configuration_error",
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe("verifyRecaptcha (configured)", () => {
  beforeEach(() => {
    configure()
    fetchSpy.mockReset()
  })

  afterEach(() => {
    restoreEnv()
    fetchSpy.mockReset()
  })

  it("rejects a missing token without calling the assessment API", async () => {
    const result = await verifyRecaptcha(undefined, "signup")
    expect(result).toEqual({
      verified: false,
      providerOutcome: "rejected",
      reason: "missing_token",
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("rejects a non-string token without calling the assessment API", async () => {
    const result = await verifyRecaptcha({ token: "x" }, "signup")
    expect(result).toEqual({
      verified: false,
      providerOutcome: "rejected",
      reason: "missing_token",
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("rejects an oversized token without calling the assessment API", async () => {
    const result = await verifyRecaptcha("a".repeat(5000), "signup")
    expect(result).toEqual({
      verified: false,
      providerOutcome: "rejected",
      reason: "token_too_long",
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("rejects a token the assessment API marks invalid", async () => {
    fetchSpy.mockResolvedValue(
      okResponse({
        tokenProperties: { valid: false, invalidReason: "EXPIRED" },
      }),
    )
    const result = await verifyRecaptcha("token", "signup")
    expect(result).toEqual({
      verified: false,
      providerOutcome: "rejected",
      reason: "EXPIRED",
    })
  })

  it("rejects when the assessment action doesn't match", async () => {
    fetchSpy.mockResolvedValue(
      okResponse({
        tokenProperties: { valid: true, action: "signin" },
        riskAnalysis: { score: 0.9 },
      }),
    )
    const result = await verifyRecaptcha("token", "signup")
    expect(result).toEqual({
      verified: false,
      providerOutcome: "rejected",
      reason: "action_mismatch",
    })
  })

  it("rejects a score below the default threshold", async () => {
    fetchSpy.mockResolvedValue(
      okResponse({
        tokenProperties: { valid: true, action: "signup" },
        riskAnalysis: { score: 0.2 },
      }),
    )
    const result = await verifyRecaptcha("token", "signup")
    expect(result).toEqual({
      verified: false,
      providerOutcome: "rejected",
      reason: "low_score:0.2",
    })
  })

  it("rejects a missing score the same as the lowest score", async () => {
    fetchSpy.mockResolvedValue(
      okResponse({ tokenProperties: { valid: true, action: "signup" } }),
    )
    const result = await verifyRecaptcha("token", "signup")
    expect(result).toEqual({
      verified: false,
      providerOutcome: "rejected",
      reason: "missing_score",
    })
  })

  it("verifies a valid token with a passing score", async () => {
    fetchSpy.mockResolvedValue(
      okResponse({
        tokenProperties: { valid: true, action: "signup" },
        riskAnalysis: { score: 0.9 },
      }),
    )
    const result = await verifyRecaptcha("token", "signup")
    expect(result).toMatchObject({
      verified: true,
      providerOutcome: "success",
    })
  })

  it("respects a configured RECAPTCHA_SCORE_THRESHOLD", async () => {
    process.env.RECAPTCHA_SCORE_THRESHOLD = "0.9"
    fetchSpy.mockResolvedValue(
      okResponse({
        tokenProperties: { valid: true, action: "signup" },
        riskAnalysis: { score: 0.8 },
      }),
    )
    const result = await verifyRecaptcha("token", "signup")
    expect(result).toMatchObject({
      verified: false,
      providerOutcome: "rejected",
      reason: "low_score:0.8",
    })
  })

  it("falls back to the default threshold for an out-of-range override", async () => {
    process.env.RECAPTCHA_SCORE_THRESHOLD = "5"
    fetchSpy.mockResolvedValue(
      okResponse({
        tokenProperties: { valid: true, action: "signup" },
        riskAnalysis: { score: 0.6 },
      }),
    )
    const result = await verifyRecaptcha("token", "signup")
    expect(result).toMatchObject({
      verified: true,
      providerOutcome: "success",
    })
  })

  it("fails closed on quota exhaustion (429) rather than opening the gate", async () => {
    fetchSpy.mockResolvedValue(new Response("rate limited", { status: 429 }))
    const result = await verifyRecaptcha("token", "signup")
    expect(result).toEqual({
      verified: false,
      providerOutcome: "configuration_error",
      reason: "quota_exhausted",
    })
  })

  it("fails closed on credential/configuration HTTP errors", async () => {
    fetchSpy.mockResolvedValue(new Response("forbidden", { status: 403 }))
    const result = await verifyRecaptcha("token", "signup")
    expect(result).toEqual({
      verified: false,
      providerOutcome: "configuration_error",
      reason: "assessment_http_403",
    })
  })

  it("fails open on transient provider errors", async () => {
    fetchSpy.mockResolvedValue(new Response("unavailable", { status: 503 }))
    const result = await verifyRecaptcha("token", "signup")
    expect(result).toEqual({ verified: true, providerOutcome: "unavailable" })
  })

  it("fails open when the request itself errors (network failure/timeout)", async () => {
    fetchSpy.mockRejectedValue(new Error("network error"))
    const result = await verifyRecaptcha("token", "signup")
    expect(result).toEqual({ verified: true, providerOutcome: "unavailable" })
  })

  it("sends the token, site key, and expected action to the assessment API", async () => {
    fetchSpy.mockResolvedValue(
      okResponse({
        tokenProperties: { valid: true, action: "signup" },
        riskAnalysis: { score: 0.9 },
      }),
    )
    await verifyRecaptcha("my-token", "signup")

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "https://recaptchaenterprise.googleapis.com/v1/projects/test-project/assessments",
      ),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          event: {
            token: "my-token",
            siteKey: "test-site-key",
            expectedAction: "signup",
          },
        }),
        signal: expect.any(AbortSignal),
      }),
    )
  })
})
