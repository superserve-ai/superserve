/**
 * getRecaptchaToken — the browser half of the reCAPTCHA gate. Page tests mock
 * this helper, so these tests cover the real polling and timeout paths. Every
 * failure must resolve to undefined within the time limits, never hang.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

type Enterprise = {
  ready: (callback: () => void) => void
  execute: (siteKey: string, options: { action: string }) => Promise<string>
}

const LOAD_TIMEOUT_MS = 8000
const EXECUTE_TIMEOUT_MS = 8000

// The site key is read when the module loads, so import it after stubbing.
async function loadClient(siteKey: string | undefined) {
  vi.stubEnv("NEXT_PUBLIC_RECAPTCHA_SITE_KEY", siteKey)
  vi.resetModules()
  return import("./client")
}

function installGrecaptcha(enterprise: Enterprise) {
  ;(window as unknown as { grecaptcha?: unknown }).grecaptcha = { enterprise }
}

function track<T>(promise: Promise<T>) {
  const state: { settled: boolean; value?: T } = { settled: false }
  void promise.then((value) => {
    state.settled = true
    state.value = value
  })
  return state
}

describe("getRecaptchaToken", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    delete (window as unknown as { grecaptcha?: unknown }).grecaptcha
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it("returns undefined without loading anything when no site key is set", async () => {
    const { getRecaptchaToken } = await loadClient(undefined)
    const execute = vi.fn()
    installGrecaptcha({ ready: (callback) => callback(), execute })

    await expect(getRecaptchaToken("signin_link")).resolves.toBeUndefined()
    expect(execute).not.toHaveBeenCalled()
  })

  it("returns the token from execute with the site key and action", async () => {
    const { getRecaptchaToken } = await loadClient("site-key")
    const execute = vi.fn().mockResolvedValue("token-123")
    installGrecaptcha({ ready: (callback) => callback(), execute })

    await expect(getRecaptchaToken("signin_link")).resolves.toBe("token-123")
    expect(execute).toHaveBeenCalledWith("site-key", { action: "signin_link" })
  })

  it("waits for a script that loads late", async () => {
    const { getRecaptchaToken } = await loadClient("site-key")
    const execute = vi.fn().mockResolvedValue("late-token")

    const result = track(getRecaptchaToken("signin_link"))
    await vi.advanceTimersByTimeAsync(1500)
    expect(result.settled).toBe(false)

    installGrecaptcha({ ready: (callback) => callback(), execute })
    await vi.advanceTimersByTimeAsync(100)

    expect(result).toEqual({ settled: true, value: "late-token" })
    expect(execute).toHaveBeenCalledWith("site-key", { action: "signin_link" })
  })

  it("returns undefined when the script never loads", async () => {
    const { getRecaptchaToken } = await loadClient("site-key")

    const result = track(getRecaptchaToken("signin_link"))
    await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS - 200)
    expect(result.settled).toBe(false)

    await vi.advanceTimersByTimeAsync(200)
    expect(result).toEqual({ settled: true, value: undefined })
  })

  it("times out when ready never calls back", async () => {
    const { getRecaptchaToken } = await loadClient("site-key")
    const execute = vi.fn()
    installGrecaptcha({ ready: () => {}, execute })

    const result = track(getRecaptchaToken("signin_link"))
    await vi.advanceTimersByTimeAsync(EXECUTE_TIMEOUT_MS - 1)
    expect(result.settled).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    expect(result).toEqual({ settled: true, value: undefined })
    expect(execute).not.toHaveBeenCalled()
  })

  it("returns undefined when execute rejects", async () => {
    const { getRecaptchaToken } = await loadClient("site-key")
    installGrecaptcha({
      ready: (callback) => callback(),
      execute: vi.fn().mockRejectedValue(new Error("invalid site key")),
    })

    // Settles at once, without waiting for the execute timeout.
    await expect(getRecaptchaToken("signin_link")).resolves.toBeUndefined()
  })

  it("times out when execute never resolves", async () => {
    const { getRecaptchaToken } = await loadClient("site-key")
    const execute = vi.fn(() => new Promise<string>(() => {}))
    installGrecaptcha({ ready: (callback) => callback(), execute })

    const result = track(getRecaptchaToken("signin_link"))
    await vi.advanceTimersByTimeAsync(EXECUTE_TIMEOUT_MS - 1)
    expect(result.settled).toBe(false)
    expect(execute).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    expect(result).toEqual({ settled: true, value: undefined })
  })
})
