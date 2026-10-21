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
    expect(await client.ensureFingerprintSignupCapture()).toEqual({
      unavailable: true,
    })
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
    expect(await client.ensureFingerprintSignupCapture()).toEqual({
      unavailable: true,
    })
    expect(await client.ensureFingerprintSignupCapture()).toEqual({
      unavailable: true,
    })
    expect(createAttempt).toHaveBeenCalledOnce()
    expect(getData).toHaveBeenCalledOnce()

    vi.resetModules()
    const reloaded = await import("./client")
    reloaded.registerFingerprintGetData(getData)
    expect(await reloaded.ensureFingerprintSignupCapture()).toEqual({
      unavailable: true,
    })
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

describe("capture diagnostics preserve behavior", () => {
  beforeEach(() => {
    vi.resetModules()
    createAttempt.mockReset().mockResolvedValue({
      attemptId: "attempt-original",
      challenge: "secret-challenge",
    })
    const values = new Map<string, string>()
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: vi.fn((key: string, value: string) => {
        values.set(key, value)
      }),
      removeItem: (key: string) => values.delete(key),
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it("keeps undefined distinct from unavailable when the SDK is not registered", async () => {
    const client = await import("./client")
    expect(await client.ensureFingerprintSignupCapture()).toBeUndefined()
    expect(client.getFingerprintSignupDiagnostics().events[0]).toMatchObject({
      stage: "capture",
      outcome: "skipped",
    })
    expect(createAttempt).not.toHaveBeenCalled()
  })

  it("records capture success followed by storage failure without retrying the provider", async () => {
    const client = await import("./client")
    const getData = vi.fn().mockResolvedValue({ event_id: "event-original" })
    client.registerFingerprintGetData(getData)
    vi.mocked(sessionStorage.setItem)
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(() => {
        throw new Error("secret storage failure")
      })
    expect(await client.ensureFingerprintSignupCapture()).toEqual({
      unavailable: true,
    })
    const diagnostic = client.getFingerprintSignupDiagnostics()
    expect(diagnostic.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: "capture",
          outcome: "succeeded",
          capture_attempt_id: "attempt-original",
          provider_event_id: "event-original",
        }),
        expect.objectContaining({
          stage: "storage_write",
          outcome: "unknown",
          reason: "storage_unavailable",
          provider_event_id: "event-original",
        }),
      ]),
    )
    expect(JSON.stringify(diagnostic)).not.toContain("secret")
    expect(await client.ensureFingerprintSignupCapture()).toMatchObject({
      eventId: "event-original",
    })
    expect(getData).toHaveBeenCalledOnce()
  })

  it("retains timeout uncertainty through reload with the original pending attempt", async () => {
    const client = await import("./client")
    const getData = vi.fn().mockRejectedValue(
      Object.assign(new Error("secret request URL"), {
        code: "client_timeout",
      }),
    )
    client.registerFingerprintGetData(getData)
    expect(await client.ensureFingerprintSignupCapture()).toEqual({
      unavailable: true,
    })
    expect(
      client.getFingerprintSignupDiagnostics().events.at(-1),
    ).toMatchObject({
      stage: "capture",
      outcome: "unknown",
      reason: "client_timeout",
    })
    vi.resetModules()
    const reloaded = await import("./client")
    reloaded.registerFingerprintGetData(getData)
    expect(await reloaded.ensureFingerprintSignupCapture()).toEqual({
      unavailable: true,
    })
    expect(reloaded.getFingerprintSignupDiagnostics().events[0]).toMatchObject({
      reason: "incomplete_capture",
      capture_attempt_id: "attempt-original",
    })
    expect(getData).toHaveBeenCalledOnce()
    expect(createAttempt).toHaveBeenCalledOnce()
  })
})

it("retains the initial failure and timestamp across retries before a signup request is sent", async () => {
  vi.resetModules()
  const values = new Map<string, string>()
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  })
  try {
    createAttempt
      .mockReset()
      .mockResolvedValue({ attemptId: "original", challenge: "secret" })
    const client = await import("./client")
    const getData = vi.fn().mockRejectedValue({ code: "csp_block" })
    client.registerFingerprintGetData(getData)
    expect(await client.ensureFingerprintSignupCapture()).toEqual({
      unavailable: true,
    })
    const originalFailure = client
      .getFingerprintSignupDiagnostics()
      .events.at(-1)
    for (let index = 0; index < 20; index++)
      await client.ensureFingerprintSignupCapture()
    const report = client.getFingerprintSignupDiagnostics()
    expect(report.events).toContainEqual(originalFailure)
    expect(report.events).toContainEqual(
      expect.objectContaining({
        reason: "incomplete_capture",
        capture_attempt_id: "original",
      }),
    )
    expect(report.events.length).toBeLessThanOrEqual(8)
    expect(originalFailure).toMatchObject({
      reason: "csp_block",
      capture_attempt_id: "original",
    })
    expect(getData).toHaveBeenCalledOnce()
    client.clearFingerprintSignupCapture()
    expect(client.getFingerprintSignupDiagnostics().events).toEqual([])
  } finally {
    vi.unstubAllGlobals()
  }
})
