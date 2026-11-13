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
  googleSignupAttemptForSignIn,
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
      mocks.ensureCapture.mockReturnValue(new Promise(() => {}))
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
      mocks.ensureCapture.mockReturnValue(new Promise(() => {}))
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
    const stall = () => {
      let finish: () => void = () => {}
      const gate = new Promise<void>((resolve) => {
        finish = resolve
      })
      return { gate, finish: () => finish() }
    }

    it.each(["capture", "recaptcha", "proof"] as const)(
      "gives up on a stalled %s at the deadline and asks for no proof",
      async (stage) => {
        vi.useFakeTimers()
        const { gate } = stall()
        if (stage === "capture")
          mocks.ensureCapture.mockReturnValue(gate.then(() => capture))
        else if (stage === "recaptcha")
          mocks.getRecaptchaToken.mockReturnValue(gate.then(() => "token"))
        else
          mocks.beginGoogleSignup.mockReturnValue(
            gate.then(() => ({ success: true, signupAttemptId: "late" })),
          )
        let settled = false
        const result = googleSignupAttemptForSignIn().then((id) => {
          settled = true
          return id
        })
        await vi.advanceTimersByTimeAsync(GOOGLE_SIGNUP_CHECK_DEADLINE_MS - 1)
        expect(settled).toBe(false)
        await vi.advanceTimersByTimeAsync(1)
        await expect(result).resolves.toBeUndefined()
      },
    )

    it("starts no proof call when a stalled capture finishes after the deadline", async () => {
      vi.useFakeTimers()
      const { gate, finish } = stall()
      mocks.ensureCapture.mockReturnValue(gate.then(() => capture))
      const result = googleSignupAttemptForSignIn()
      await vi.advanceTimersByTimeAsync(GOOGLE_SIGNUP_CHECK_DEADLINE_MS)
      await expect(result).resolves.toBeUndefined()
      finish()
      await vi.advanceTimersByTimeAsync(0)
      expect(mocks.getRecaptchaToken).not.toHaveBeenCalled()
      expect(mocks.beginGoogleSignup).not.toHaveBeenCalled()
    })

    it("starts no proof call when a stalled reCAPTCHA answers after the deadline", async () => {
      vi.useFakeTimers()
      const { gate, finish } = stall()
      mocks.getRecaptchaToken.mockReturnValue(gate.then(() => "token"))
      const result = googleSignupAttemptForSignIn()
      await vi.advanceTimersByTimeAsync(GOOGLE_SIGNUP_CHECK_DEADLINE_MS)
      await expect(result).resolves.toBeUndefined()
      finish()
      await vi.advanceTimersByTimeAsync(0)
      expect(mocks.beginGoogleSignup).not.toHaveBeenCalled()
    })

    it("keeps a late proof out of the result", async () => {
      vi.useFakeTimers()
      const { gate, finish } = stall()
      mocks.beginGoogleSignup.mockReturnValue(
        gate.then(() => ({ success: true, signupAttemptId: "late" })),
      )
      const settled = vi.fn()
      const result = googleSignupAttemptForSignIn().then(settled)
      await vi.advanceTimersByTimeAsync(GOOGLE_SIGNUP_CHECK_DEADLINE_MS)
      await result
      finish()
      await vi.advanceTimersByTimeAsync(0)
      expect(settled).toHaveBeenCalledExactlyOnceWith(undefined)
    })

    it("does not let an old check act once a newer one has started", async () => {
      const first = stall()
      mocks.ensureCapture.mockReturnValueOnce(first.gate.then(() => capture))
      const older = googleSignupAttemptForSignIn()
      const newer = googleSignupAttemptForSignIn()
      await expect(newer).resolves.toBe("attempt-1")
      first.finish()
      await expect(older).resolves.toBeUndefined()
      expect(mocks.beginGoogleSignup).toHaveBeenCalledTimes(1)
    })

    it("does not carry a cancelled check into the next one", async () => {
      vi.useFakeTimers()
      const first = stall()
      mocks.ensureCapture.mockReturnValueOnce(first.gate.then(() => capture))
      const expired = googleSignupAttemptForSignIn()
      await vi.advanceTimersByTimeAsync(GOOGLE_SIGNUP_CHECK_DEADLINE_MS)
      await expired
      const next = googleSignupAttemptForSignIn()
      first.finish()
      await expect(next).resolves.toBe("attempt-1")
      expect(mocks.beginGoogleSignup).toHaveBeenCalledTimes(1)
    })

    it("accepts a shorter deadline", async () => {
      vi.useFakeTimers()
      mocks.ensureCapture.mockReturnValue(new Promise(() => {}))
      const result = googleSignupAttemptForSignIn(250)
      await vi.advanceTimersByTimeAsync(250)
      await expect(result).resolves.toBeUndefined()
    })
  })
})
