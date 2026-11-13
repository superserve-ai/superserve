import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  beginGoogleSignup: vi.fn(),
  cloudflareEnabled: vi.fn(),
  turnstileToken: vi.fn(),
  turnstileSiteKey: { value: undefined as string | undefined },
  ensureCapture: vi.fn(),
  diagnostics: vi.fn(),
  getRecaptchaToken: vi.fn(),
  siteKey: { value: "site-key" as string | undefined },
}))

vi.mock("@/app/(auth)/auth/signup/action", () => ({
  beginGoogleSignup: (...args: unknown[]) => mocks.beginGoogleSignup(...args),
  isCloudflareSignupObservationEnabled: () => mocks.cloudflareEnabled(),
}))
vi.mock("@/lib/cloudflare/turnstile-client", () => ({
  get TURNSTILE_SITE_KEY() {
    return mocks.turnstileSiteKey.value
  },
  getTurnstileToken: (signal?: AbortSignal) => mocks.turnstileToken(signal),
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

import {
  GOOGLE_SIGNUP_CHECK_DEADLINE_MS,
  GOOGLE_SIGNUP_PROOF_DEADLINE_MS,
  googleSignupAttemptForSignIn,
  prefetchGoogleSignupCheck,
} from "./google-signup-check"

const capture = { attemptId: "capture-1", challenge: "c", eventId: "e" }
const diagnostics = { schema_version: 1, events: [] }

describe("googleSignupAttemptForSignIn", () => {
  beforeEach(() => {
    mocks.siteKey.value = "site-key"
    mocks.turnstileSiteKey.value = undefined
    mocks.cloudflareEnabled.mockReset().mockResolvedValue(true)
    mocks.turnstileToken.mockReset().mockResolvedValue("turnstile-token")
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

  describe("Turnstile observation", () => {
    beforeEach(() => {
      mocks.turnstileSiteKey.value = "turnstile-site-key"
    })

    it("sends the Turnstile token when the observation is enabled", async () => {
      await expect(googleSignupAttemptForSignIn()).resolves.toBe("attempt-1")
      expect(mocks.beginGoogleSignup).toHaveBeenCalledExactlyOnceWith(
        "token",
        "turnstile-token",
        capture,
        diagnostics,
        "signin",
      )
    })

    it("collects no token when the observation is disabled", async () => {
      mocks.cloudflareEnabled.mockResolvedValue(false)
      await googleSignupAttemptForSignIn()
      expect(mocks.turnstileToken).not.toHaveBeenCalled()
      expect(mocks.beginGoogleSignup.mock.calls[0][1]).toBeUndefined()
    })

    it("collects no token without a site key", async () => {
      mocks.turnstileSiteKey.value = undefined
      await googleSignupAttemptForSignIn()
      expect(mocks.cloudflareEnabled).not.toHaveBeenCalled()
      expect(mocks.beginGoogleSignup.mock.calls[0][1]).toBeUndefined()
    })

    it("still asks for the proof, without a token, when Turnstile fails", async () => {
      mocks.turnstileToken.mockRejectedValue(new Error("widget"))
      await expect(googleSignupAttemptForSignIn()).resolves.toBe("attempt-1")
      expect(mocks.beginGoogleSignup.mock.calls[0][1]).toBeUndefined()
    })

    it("does not let a stalled Turnstile widget hold back the proof", async () => {
      vi.useFakeTimers()
      mocks.turnstileToken.mockReturnValue(new Promise(() => {}))
      const result = googleSignupAttemptForSignIn()
      await vi.advanceTimersByTimeAsync(2_499)
      expect(mocks.beginGoogleSignup).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      await expect(result).resolves.toBe("attempt-1")
      expect(mocks.beginGoogleSignup.mock.calls[0][1]).toBeUndefined()
    })
  })

  describe("Cloudflare flag prefetch", () => {
    beforeEach(() => {
      mocks.turnstileSiteKey.value = "turnstile-site-key"
    })

    it("uses the flag asked for at page load instead of asking at the click", async () => {
      prefetchGoogleSignupCheck()
      prefetchGoogleSignupCheck()
      expect(mocks.cloudflareEnabled).toHaveBeenCalledTimes(1)
      await expect(googleSignupAttemptForSignIn()).resolves.toBe("attempt-1")
      expect(mocks.cloudflareEnabled).toHaveBeenCalledTimes(1)
      expect(mocks.beginGoogleSignup.mock.calls[0][1]).toBe("turnstile-token")
      // The prefetched answer serves one check; a retry asks again.
      await googleSignupAttemptForSignIn()
      expect(mocks.cloudflareEnabled).toHaveBeenCalledTimes(2)
    })

    it("asks again at the click when the prefetch failed", async () => {
      mocks.cloudflareEnabled.mockRejectedValueOnce(new Error("network"))
      prefetchGoogleSignupCheck()
      await Promise.resolve()
      await Promise.resolve()
      await expect(googleSignupAttemptForSignIn()).resolves.toBe("attempt-1")
      expect(mocks.cloudflareEnabled).toHaveBeenCalledTimes(2)
      expect(mocks.beginGoogleSignup.mock.calls[0][1]).toBe("turnstile-token")
    })

    it("asks for nothing without a site key", () => {
      mocks.turnstileSiteKey.value = undefined
      prefetchGoogleSignupCheck()
      expect(mocks.cloudflareEnabled).not.toHaveBeenCalled()
    })

    it("starts the capture before a flag lookup sent at the click", async () => {
      // Server actions run one at a time, so the capture action goes first.
      await googleSignupAttemptForSignIn()
      expect(mocks.ensureCapture.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.cloudflareEnabled.mock.invocationCallOrder[0],
      )
    })
  })

  describe("Turnstile cancellation", () => {
    beforeEach(() => {
      mocks.turnstileSiteKey.value = "turnstile-site-key"
    })

    it("starts no widget when the flag answer arrives after the check expired", async () => {
      vi.useFakeTimers()
      let answer: (enabled: boolean) => void = () => {}
      mocks.cloudflareEnabled.mockReturnValue(
        new Promise<boolean>((resolve) => {
          answer = resolve
        }),
      )
      mocks.getRecaptchaToken.mockReturnValue(new Promise(() => {}))
      const result = googleSignupAttemptForSignIn()
      await vi.advanceTimersByTimeAsync(GOOGLE_SIGNUP_CHECK_DEADLINE_MS)
      await expect(result).resolves.toBeUndefined()
      answer(true)
      await vi.advanceTimersByTimeAsync(0)
      expect(mocks.turnstileToken).not.toHaveBeenCalled()
    })

    it("cancels the widget when the check expires", async () => {
      vi.useFakeTimers()
      let signal: AbortSignal | undefined
      mocks.turnstileToken.mockImplementation((given?: AbortSignal) => {
        signal = given
        return new Promise(() => {})
      })
      mocks.getRecaptchaToken.mockReturnValue(new Promise(() => {}))
      // Shorter than the Turnstile budget, so the check is what cancels it.
      const result = googleSignupAttemptForSignIn(1_000)
      await vi.advanceTimersByTimeAsync(999)
      expect(signal?.aborted).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect(signal?.aborted).toBe(true)
      await expect(result).resolves.toBeUndefined()
    })

    it("cancels the widget when its own budget runs out", async () => {
      vi.useFakeTimers()
      let signal: AbortSignal | undefined
      mocks.turnstileToken.mockImplementation((given?: AbortSignal) => {
        signal = given
        return new Promise(() => {})
      })
      const result = googleSignupAttemptForSignIn()
      await vi.advanceTimersByTimeAsync(2_499)
      expect(signal?.aborted).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect(signal?.aborted).toBe(true)
      await expect(result).resolves.toBe("attempt-1")
    })

    it("cancels the widget of an older check when a newer one starts", async () => {
      let signal: AbortSignal | undefined
      mocks.turnstileToken.mockImplementationOnce((given?: AbortSignal) => {
        signal = given
        return new Promise(() => {})
      })
      mocks.ensureCapture.mockReturnValueOnce(new Promise(() => {}))
      void googleSignupAttemptForSignIn()
      await Promise.resolve()
      await Promise.resolve()
      expect(signal?.aborted).toBe(false)
      await googleSignupAttemptForSignIn()
      expect(signal?.aborted).toBe(true)
    })
  })

  describe("deadline", () => {
    const stall = <T>(value: T) => {
      let finish: () => void = () => {}
      const gate = new Promise<void>((resolve) => {
        finish = resolve
      })
      return { promise: gate.then(() => value), finish: () => finish() }
    }

    it("runs the capture and reCAPTCHA side by side", async () => {
      const slowCapture = stall(capture)
      const slowToken = stall("token")
      mocks.ensureCapture.mockReturnValue(slowCapture.promise)
      mocks.getRecaptchaToken.mockReturnValue(slowToken.promise)
      const result = googleSignupAttemptForSignIn()
      expect(mocks.ensureCapture).toHaveBeenCalledTimes(1)
      expect(mocks.getRecaptchaToken).toHaveBeenCalledTimes(1)
      slowToken.finish()
      slowCapture.finish()
      await expect(result).resolves.toBe("attempt-1")
    })

    it("gives up on a stalled reCAPTCHA at the deadline and asks for no proof", async () => {
      vi.useFakeTimers()
      mocks.getRecaptchaToken.mockReturnValue(new Promise(() => {}))
      let settled = false
      const result = googleSignupAttemptForSignIn().then((id) => {
        settled = true
        return id
      })
      await vi.advanceTimersByTimeAsync(GOOGLE_SIGNUP_CHECK_DEADLINE_MS - 1)
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      await expect(result).resolves.toBeUndefined()
      expect(mocks.beginGoogleSignup).not.toHaveBeenCalled()
    })

    it("reports a slow capture as unavailable and still issues the proof", async () => {
      vi.useFakeTimers()
      const slowCapture = stall(capture)
      mocks.ensureCapture.mockReturnValue(slowCapture.promise)
      const result = googleSignupAttemptForSignIn()
      await vi.advanceTimersByTimeAsync(2_999)
      expect(mocks.beginGoogleSignup).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      await expect(result).resolves.toBe("attempt-1")
      expect(mocks.beginGoogleSignup).toHaveBeenCalledExactlyOnceWith(
        "token",
        undefined,
        { unavailable: true },
        diagnostics,
        "signin",
      )
      slowCapture.finish()
      await vi.advanceTimersByTimeAsync(0)
      expect(mocks.beginGoogleSignup).toHaveBeenCalledTimes(1)
    })

    it("uses a proof that answers after the browser deadline but inside the proof deadline", async () => {
      // The production case: a slow capture and server call put the answer
      // just past four seconds, and the page went to Google without it.
      vi.useFakeTimers()
      const slowCapture = stall(capture)
      const slowProof = stall({ success: true, signupAttemptId: "late" })
      mocks.ensureCapture.mockReturnValue(slowCapture.promise)
      mocks.beginGoogleSignup.mockReturnValue(slowProof.promise)
      let settled = false
      const result = googleSignupAttemptForSignIn().then((id) => {
        settled = true
        return id
      })
      await vi.advanceTimersByTimeAsync(2_600)
      slowCapture.finish()
      await vi.advanceTimersByTimeAsync(0)
      expect(mocks.beginGoogleSignup).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(GOOGLE_SIGNUP_CHECK_DEADLINE_MS)
      expect(settled).toBe(false)
      slowProof.finish()
      await expect(result).resolves.toBe("late")
    })

    it("gives up on a stalled proof at the proof deadline", async () => {
      vi.useFakeTimers()
      mocks.beginGoogleSignup.mockReturnValue(new Promise(() => {}))
      let settled = false
      const result = googleSignupAttemptForSignIn().then((id) => {
        settled = true
        return id
      })
      await vi.advanceTimersByTimeAsync(GOOGLE_SIGNUP_PROOF_DEADLINE_MS - 1)
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      await expect(result).resolves.toBeUndefined()
    })

    it("starts no proof call when the browser steps finish after the deadline", async () => {
      vi.useFakeTimers()
      const slowCapture = stall(capture)
      const slowToken = stall("token")
      mocks.ensureCapture.mockReturnValue(slowCapture.promise)
      mocks.getRecaptchaToken.mockReturnValue(slowToken.promise)
      const result = googleSignupAttemptForSignIn()
      await vi.advanceTimersByTimeAsync(GOOGLE_SIGNUP_CHECK_DEADLINE_MS)
      await expect(result).resolves.toBeUndefined()
      slowCapture.finish()
      slowToken.finish()
      await vi.advanceTimersByTimeAsync(0)
      expect(mocks.beginGoogleSignup).not.toHaveBeenCalled()
    })

    it("keeps a proof that answers after the proof deadline out of the result", async () => {
      vi.useFakeTimers()
      const slowProof = stall({ success: true, signupAttemptId: "late" })
      mocks.beginGoogleSignup.mockReturnValue(slowProof.promise)
      const settled = vi.fn()
      const result = googleSignupAttemptForSignIn().then(settled)
      await vi.advanceTimersByTimeAsync(GOOGLE_SIGNUP_PROOF_DEADLINE_MS)
      await result
      slowProof.finish()
      await vi.advanceTimersByTimeAsync(0)
      expect(settled).toHaveBeenCalledExactlyOnceWith(undefined)
    })

    it("does not let an old check act once a newer one has started", async () => {
      const first = stall(capture)
      mocks.ensureCapture.mockReturnValueOnce(first.promise)
      const older = googleSignupAttemptForSignIn()
      const newer = googleSignupAttemptForSignIn()
      await expect(newer).resolves.toBe("attempt-1")
      first.finish()
      await expect(older).resolves.toBeUndefined()
      expect(mocks.beginGoogleSignup).toHaveBeenCalledTimes(1)
    })

    it("does not carry a cancelled check into the next one", async () => {
      vi.useFakeTimers()
      const first = stall("token")
      mocks.getRecaptchaToken.mockReturnValueOnce(first.promise)
      const expired = googleSignupAttemptForSignIn()
      await vi.advanceTimersByTimeAsync(GOOGLE_SIGNUP_CHECK_DEADLINE_MS)
      await expired
      const next = googleSignupAttemptForSignIn()
      first.finish()
      await expect(next).resolves.toBe("attempt-1")
      expect(mocks.beginGoogleSignup).toHaveBeenCalledTimes(1)
    })

    it("accepts shorter deadlines", async () => {
      vi.useFakeTimers()
      mocks.ensureCapture.mockReturnValue(new Promise(() => {}))
      const result = googleSignupAttemptForSignIn(250)
      await vi.advanceTimersByTimeAsync(250)
      await expect(result).resolves.toBeUndefined()

      mocks.ensureCapture.mockResolvedValue(capture)
      mocks.beginGoogleSignup.mockReturnValue(new Promise(() => {}))
      const proof = googleSignupAttemptForSignIn(250, 500)
      await vi.advanceTimersByTimeAsync(500)
      await expect(proof).resolves.toBeUndefined()
    })
  })
})
