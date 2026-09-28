import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const createAttempt = vi.hoisted(() => vi.fn())
vi.mock("@/app/(auth)/auth/signup/action", () => ({
  createSignupFingerprintAttempt: createAttempt,
}))

describe("signup capture retry boundary", () => {
  let values: Map<string, string>

  beforeEach(() => {
    vi.resetModules()
    values = new Map()
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    })
    createAttempt.mockReset().mockResolvedValue({
      attemptId: "attempt-original",
      challenge: "challenge-original",
    })
  })

  afterEach(() => vi.unstubAllGlobals())

  it("shares one issued challenge and event between overlapping submissions", async () => {
    const client = await import("./client")
    const getData = vi.fn().mockResolvedValue({ event_id: "event-original" })
    client.registerFingerprintGetData(getData)
    const [first, overlapping] = await Promise.all([
      client.ensureFingerprintSignupCapture(),
      client.ensureFingerprintSignupCapture(),
    ])
    expect(first).toEqual({
      attemptId: "attempt-original",
      challenge: "challenge-original",
      eventId: "event-original",
    })
    expect(overlapping).toEqual(first)
    expect(createAttempt).toHaveBeenCalledOnce()
    expect(getData).toHaveBeenCalledExactlyOnceWith({
      tag: { signup_challenge: "challenge-original" },
    })
    expect(await client.ensureFingerprintSignupCapture()).toEqual(first)
    expect(getData).toHaveBeenCalledOnce()
  })

  it("permits a fresh attempt after a lost pre-capture response", async () => {
    createAttempt.mockRejectedValueOnce(new Error("response lost"))
    const client = await import("./client")
    const getData = vi.fn().mockResolvedValue({ event_id: "event-original" })
    client.registerFingerprintGetData(getData)
    expect(await client.ensureFingerprintSignupCapture()).toBeUndefined()
    expect(getData).not.toHaveBeenCalled()
    expect(await client.ensureFingerprintSignupCapture()).toMatchObject({
      attemptId: "attempt-original",
    })
    expect(createAttempt).toHaveBeenCalledTimes(2)
    expect(getData).toHaveBeenCalledOnce()
  })

  it("does not replace an event after capture starts and the provider response is lost", async () => {
    const client = await import("./client")
    const getData = vi.fn().mockRejectedValue(new Error("response lost"))
    client.registerFingerprintGetData(getData)
    expect(await client.ensureFingerprintSignupCapture()).toBeUndefined()
    expect(await client.ensureFingerprintSignupCapture()).toBeUndefined()
    expect(createAttempt).toHaveBeenCalledOnce()
    expect(getData).toHaveBeenCalledOnce()

    vi.resetModules()
    const reloaded = await import("./client")
    reloaded.registerFingerprintGetData(getData)
    expect(await reloaded.ensureFingerprintSignupCapture()).toBeUndefined()
    expect(getData).toHaveBeenCalledOnce()
  })

  it("retains the captured pairing across refresh without another lookup", async () => {
    const client = await import("./client")
    const getData = vi.fn().mockResolvedValue({ event_id: "event-original" })
    client.registerFingerprintGetData(getData)
    const original = await client.ensureFingerprintSignupCapture()
    vi.resetModules()
    const reloaded = await import("./client")
    reloaded.registerFingerprintGetData(getData)
    expect(await reloaded.ensureFingerprintSignupCapture()).toEqual(original)
    expect(createAttempt).toHaveBeenCalledOnce()
    expect(getData).toHaveBeenCalledOnce()
  })

  it("does not clear an in-flight capture when asked to clear transport", async () => {
    const client = await import("./client")
    let finish!: (value: { event_id: string }) => void
    const getData = vi.fn(
      () =>
        new Promise<{ event_id: string }>((resolve) => {
          finish = resolve
        }),
    )
    client.registerFingerprintGetData(getData)
    const original = client.ensureFingerprintSignupCapture()
    await Promise.resolve()
    client.clearFingerprintSignupCapture()
    expect(client.ensureFingerprintSignupCapture()).toBe(original)
    finish({ event_id: "event-original" })
    expect(await original).toMatchObject({ eventId: "event-original" })
    expect(getData).toHaveBeenCalledOnce()
  })
})
