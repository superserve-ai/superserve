import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Runs the check with the real Heedeo client, so a capture the check gave up
// on is seen to start no identify.

const mocks = vi.hoisted(() => ({
  beginGoogleSignup: vi.fn(),
  getRecaptchaToken: vi.fn(),
}))

vi.mock("@/app/(auth)/auth/signup/action", () => ({
  beginGoogleSignup: (...args: unknown[]) => mocks.beginGoogleSignup(...args),
  isCloudflareSignupObservationEnabled: async () => false,
}))
vi.mock("@/lib/cloudflare/turnstile-client", () => ({
  TURNSTILE_SITE_KEY: undefined,
  getTurnstileToken: async () => undefined,
}))
vi.mock("@/lib/fingerprint/client", () => ({
  ensureFingerprintSignupCapture: async () => ({ unavailable: true }),
  getFingerprintSignupDiagnostics: () => ({ schema_version: 1, events: [] }),
}))
vi.mock("@/lib/recaptcha/client", () => ({
  RECAPTCHA_SITE_KEY: "site-key",
  getRecaptchaToken: (action: string) => mocks.getRecaptchaToken(action),
}))

type CheckModule = typeof import("./google-signup-check")

async function load(): Promise<CheckModule> {
  vi.resetModules()
  vi.stubEnv("NEXT_PUBLIC_HEEDEO_KEY", "pk_live_123")
  return import("./google-signup-check")
}

let writes: string[] = []

beforeEach(() => {
  writes = []
  mocks.getRecaptchaToken.mockReset().mockResolvedValue("token")
  mocks.beginGoogleSignup
    .mockReset()
    .mockResolvedValue({ success: true, signupAttemptId: "attempt-1" })
  const append = document.head.appendChild.bind(document.head)
  vi.spyOn(document.head, "appendChild").mockImplementation((node) =>
    node instanceof HTMLScriptElement ? node : append(node),
  )
  vi.spyOn(document, "cookie", "set").mockImplementation((value: string) => {
    writes.push(value)
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  delete window.heedeo
})

function heedeoCookieWrites(): string[] {
  return writes.filter(
    (write) =>
      write.startsWith("superserve-heedeo-signup=") &&
      !write.startsWith("superserve-heedeo-signup=;"),
  )
}

describe("Heedeo capture in the Google sign-up check", () => {
  it("does not identify after the check is cancelled", async () => {
    vi.useFakeTimers()
    const check = await load()
    mocks.getRecaptchaToken.mockReturnValue(new Promise(() => {}))
    const attempt = check.googleSignupAttemptForSignIn()
    await vi.advanceTimersByTimeAsync(100)
    check.cancelGoogleSignupCheck()
    const identify = vi.fn(async () => ({
      token: "ct1.late",
      visitor_id: "v",
      confidence: 1,
    }))
    window.heedeo = { identify }
    await vi.advanceTimersByTimeAsync(3000)
    expect(identify).not.toHaveBeenCalled()
    expect(heedeoCookieWrites()).toEqual([])
    attempt.catch(() => {})
  })

  it("does not identify after the server refuses the proof", async () => {
    vi.useFakeTimers()
    const check = await load()
    mocks.beginGoogleSignup.mockResolvedValue({
      success: false,
      errorCode: "captcha_failed",
    })
    const attempt = check.googleSignupAttemptForSignIn()
    await vi.advanceTimersByTimeAsync(0)
    await expect(attempt).resolves.toBeUndefined()
    const identify = vi.fn(async () => ({
      token: "ct1.late",
      visitor_id: "v",
      confidence: 1,
    }))
    window.heedeo = { identify }
    await vi.advanceTimersByTimeAsync(3000)
    expect(identify).not.toHaveBeenCalled()
    expect(heedeoCookieWrites()).toEqual([])
  })

  it("still identifies for a check that sends the browser to Google", async () => {
    vi.useFakeTimers()
    const check = await load()
    const identify = vi.fn(async () => ({
      token: "ct1.ok",
      visitor_id: "v",
      confidence: 1,
    }))
    window.heedeo = { identify }
    const attempt = check.googleSignupAttemptForSignIn()
    await vi.advanceTimersByTimeAsync(0)
    await expect(attempt).resolves.toBe("attempt-1")
    expect(identify).toHaveBeenCalledTimes(1)
    expect(heedeoCookieWrites()).toHaveLength(1)
  })
})
