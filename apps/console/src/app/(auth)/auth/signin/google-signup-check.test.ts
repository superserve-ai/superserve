import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  beginGoogleSignup: vi.fn(),
  ensureCapture: vi.fn(),
  diagnostics: vi.fn(),
  getRecaptchaToken: vi.fn(),
  siteKey: { value: "site-key" as string | undefined },
}))

vi.mock("@/app/(auth)/auth/signup/action", () => ({
  beginGoogleSignup: (...args: unknown[]) => mocks.beginGoogleSignup(...args),
}))
vi.mock("@/lib/fingerprint/client", () => ({
  ensureFingerprintSignupCapture: () => mocks.ensureCapture(),
  getFingerprintSignupDiagnostics: () => mocks.diagnostics(),
}))
vi.mock("@/lib/recaptcha/client", () => ({
  get RECAPTCHA_SITE_KEY() {
    return mocks.siteKey.value
  },
  getRecaptchaToken: (action: string) => mocks.getRecaptchaToken(action),
}))

import { googleSignupAttemptForSignIn } from "./google-signup-check"

const capture = { attemptId: "capture-1", challenge: "c", eventId: "e" }
const diagnostics = { schema_version: 1, events: [] }

describe("googleSignupAttemptForSignIn", () => {
  beforeEach(() => {
    mocks.siteKey.value = "site-key"
    mocks.ensureCapture.mockReset().mockResolvedValue(capture)
    mocks.diagnostics.mockReset().mockReturnValue(diagnostics)
    mocks.getRecaptchaToken.mockReset().mockResolvedValue("token")
    mocks.beginGoogleSignup
      .mockReset()
      .mockResolvedValue({ success: true, signupAttemptId: "attempt-1" })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("runs the signup_google check with the capture and labels it as sign-in", async () => {
    await expect(googleSignupAttemptForSignIn()).resolves.toBe("attempt-1")
    expect(mocks.getRecaptchaToken).toHaveBeenCalledExactlyOnceWith(
      "signup_google",
    )
    expect(mocks.beginGoogleSignup).toHaveBeenCalledExactlyOnceWith(
      "token",
      undefined,
      capture,
      diagnostics,
      "signin",
    )
  })

  it("asks for no proof when reCAPTCHA gives no token", async () => {
    mocks.getRecaptchaToken.mockResolvedValue(undefined)
    await expect(googleSignupAttemptForSignIn()).resolves.toBeUndefined()
    expect(mocks.beginGoogleSignup).not.toHaveBeenCalled()
  })

  it("runs the server check without a token when reCAPTCHA is not configured", async () => {
    mocks.siteKey.value = undefined
    mocks.getRecaptchaToken.mockResolvedValue(undefined)
    await expect(googleSignupAttemptForSignIn()).resolves.toBe("attempt-1")
    expect(mocks.beginGoogleSignup).toHaveBeenCalledWith(
      undefined,
      undefined,
      capture,
      diagnostics,
      "signin",
    )
  })

  it("returns no attempt when the server refuses the check", async () => {
    mocks.beginGoogleSignup.mockResolvedValue({
      success: false,
      error: "x",
      errorCode: "captcha_failed",
    })
    await expect(googleSignupAttemptForSignIn()).resolves.toBeUndefined()
  })

  it("returns no attempt when the check throws", async () => {
    mocks.ensureCapture.mockRejectedValue(new Error("storage"))
    await expect(googleSignupAttemptForSignIn()).resolves.toBeUndefined()
    mocks.ensureCapture.mockResolvedValue(capture)
    mocks.beginGoogleSignup.mockRejectedValue(new Error("network"))
    await expect(googleSignupAttemptForSignIn()).resolves.toBeUndefined()
  })

  it("stops waiting after the time limit so sign-in is not held up", async () => {
    vi.useFakeTimers()
    mocks.beginGoogleSignup.mockReturnValue(new Promise(() => {}))
    const result = googleSignupAttemptForSignIn(5000)
    await vi.advanceTimersByTimeAsync(4999)
    let settled = false
    void result.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await expect(result).resolves.toBeUndefined()
  })
})
