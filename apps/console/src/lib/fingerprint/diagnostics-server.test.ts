import { afterEach, beforeEach, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  batch: vi.fn(),
  createAttempt: vi.fn(),
}))
vi.mock("next/server", () => ({ after: mocks.after }))
vi.mock("@/lib/posthog/batch", () => ({ trackEventBatch: mocks.batch }))
vi.mock("@/app/(auth)/auth/signup/action", () => ({
  createSignupFingerprintAttempt: mocks.createAttempt,
}))
import { fingerprintDiagnostics } from "./diagnostics-server"

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, "info").mockImplementation(() => {})
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
const row = {
  stage: "capture",
  outcome: "unknown",
  reason: "client_timeout",
  occurred_at: "2026-10-21T12:00:00.000Z",
} as const

it("retains occurrence time, links untrusted reports without identifying users, and batches after response", async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-10-21T12:01:00Z"))
  const diagnostic = fingerprintDiagnostics({
    signupAttemptId: "server-attempt",
    captureAttemptId: "submitted-attempt",
  })
  diagnostic.browser({
    schema_version: 1,
    events: [
      {
        ...row,
        capture_attempt_id: "forged-id",
        challenge: "secret",
        userId: "victim",
        proof: "secret",
      },
    ],
  })
  diagnostic.record({
    stage: "submission",
    outcome: "succeeded",
    reason: "capture_unavailable",
  })
  expect(mocks.after).toHaveBeenCalledOnce()
  expect(mocks.batch).not.toHaveBeenCalled()
  vi.setSystemTime(new Date("2026-10-21T12:05:00Z"))
  await mocks.after.mock.calls[0][0]()
  const events = mocks.batch.mock.calls[0][0]
  expect(events).toHaveLength(2)
  expect(events[0]).toMatchObject({
    event: "auth_fingerprint_signup_capture",
    properties: {
      source: "client_reported",
      capture_attempt_id: "forged-id",
      signup_attempt_id: "server-attempt",
      occurred_at: row.occurred_at,
      $process_person_profile: false,
    },
  })
  expect(events[0].distinctId).not.toBe("forged-id")
  expect(events[0].properties.superserve_user_id).toBeUndefined()
  expect(events[1].properties.occurred_at).toBe("2026-10-21T12:01:00.000Z")
  expect(JSON.stringify(events)).not.toContain("secret")
  expect(JSON.stringify(events)).not.toContain("victim")
})

it("labels every diagnostic with the page that ran the check", async () => {
  const diagnostic = fingerprintDiagnostics({
    signupAttemptId: "server-attempt",
    entryPoint: "signin",
  })
  diagnostic.browser({ schema_version: 1, events: [row] })
  diagnostic.record({
    stage: "submission",
    outcome: "succeeded",
    reason: "capture_present",
  })
  await mocks.after.mock.calls[0][0]()
  const events = mocks.batch.mock.calls[0][0]
  expect(events).toHaveLength(2)
  for (const event of events)
    expect(event.properties.entry_point).toBe("signin")
})

it("bounds reports, discards server stages from browser reports, and rejects arbitrary fields/codes", async () => {
  const diagnostic = fingerprintDiagnostics({})
  diagnostic.browser({
    schema_version: 1,
    events: [
      { ...row, stage: "attachment", outcome: "succeeded", reason: "bound" },
      { ...row, reason: "raw error with a token" },
      ...Array.from({ length: 100 }, () => row),
    ],
  })
  for (let index = 0; index < 100; index++)
    diagnostic.record({
      stage: "lookup",
      outcome: "succeeded",
      reason: "completed",
    })
  await mocks.after.mock.calls[0][0]()
  const events = mocks.batch.mock.calls[0][0]
  expect(events).toHaveLength(12)
  expect(
    events.filter(
      (e: { properties: { source: string } }) =>
        e.properties.source === "client_reported",
    ),
  ).toHaveLength(6)
  expect(
    events.some((e: { event: string }) => e.event.includes("attachment")),
  ).toBe(false)
})

it("treats old clients and unknown schemas as missing diagnostics", async () => {
  const diagnostic = fingerprintDiagnostics({})
  diagnostic.browser(undefined)
  diagnostic.browser({ schema_version: 99, events: [row] })
  await mocks.after.mock.calls[0][0]()
  expect(mocks.batch.mock.calls[0][0]).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        properties: expect.objectContaining({
          outcome: "unknown",
          reason: "browser_diagnostics_missing",
        }),
      }),
    ]),
  )
})

it("isolates scheduling, logging, and rejected delivery from callers", async () => {
  mocks.after.mockImplementationOnce(() => {
    throw new Error("no lifecycle")
  })
  expect(() => fingerprintDiagnostics({}).record(row)).not.toThrow()
  mocks.after.mockReset()
  mocks.batch.mockRejectedValue(new Error("offline"))
  fingerprintDiagnostics({}).record(row)
  await expect(mocks.after.mock.calls[0][0]()).resolves.toBeUndefined()
  vi.mocked(console.info).mockImplementation(() => {
    throw new Error("logger offline")
  })
  await expect(mocks.after.mock.calls[0][0]()).resolves.toBeUndefined()
})

it("never fills a pending browser capture with a different tab's cookie event", async () => {
  const diagnostic = fingerprintDiagnostics({
    signupAttemptId: "signup",
    eventId: "tab-b-event",
  })
  diagnostic.browser({
    schema_version: 1,
    events: [
      {
        ...row,
        capture_attempt_id: "tab-a-attempt",
        reason: "incomplete_capture",
      },
    ],
  })
  await mocks.after.mock.calls[0][0]()
  const properties = mocks.batch.mock.calls[0][0][0].properties
  expect(properties.capture_attempt_id).toBe("tab-a-attempt")
  expect(properties.provider_event_id).toBeUndefined()
  expect(properties.signup_attempt_id).toBe("signup")
})

it.each([
  ["api_key_invalid", "sdk_error"],
  ["wrong_region", "sdk_error"],
  ["subscription_not_active", "sdk_error"],
  ["too_many_requests", "sdk_error"],
  ["network_connection", "network_connection"],
])(
  "delivers safe %s details from SDK rejection through browser JSON",
  async (code, reason) => {
    const values = new Map<string, string>()
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    })
    mocks.createAttempt.mockResolvedValue({
      attemptId: "capture-attempt",
      challenge: "secret-challenge",
    })
    const client = await import("./client")
    client.clearFingerprintSignupCapture()
    const getData = vi.fn().mockRejectedValue(
      Object.assign(
        new Error("secret request https://provider/?token=secret"),
        {
          name: "FingerprintError",
          code,
          event_id: "unreturned-event",
          visitor_id: "secret-visitor",
        },
      ),
    )
    client.registerFingerprintGetData(getData)
    expect(await client.ensureFingerprintSignupCapture()).toEqual({
      unavailable: true,
    })

    const report = JSON.parse(
      JSON.stringify(client.getFingerprintSignupDiagnostics()),
    )
    fingerprintDiagnostics({ signupAttemptId: "signup-attempt" }).browser(
      report,
    )
    await mocks.after.mock.calls[0][0]()
    const events = mocks.batch.mock.calls[0][0]
    expect(
      events.find(
        (event: { event: string }) =>
          event.event === "auth_fingerprint_signup_capture",
      ),
    ).toMatchObject({
      properties: {
        stage: "capture",
        outcome: "unknown",
        reason,
        sdk_error_code: code,
        sdk_error_type: "FingerprintError",
        capture_attempt_id: "capture-attempt",
        source: "client_reported",
      },
    })
    expect(JSON.stringify(events)).not.toContain("secret")
    expect(JSON.stringify(events)).not.toContain("https:")
    expect(JSON.stringify(events)).not.toContain("unreturned-event")
    expect(await client.ensureFingerprintSignupCapture()).toEqual({
      unavailable: true,
    })
    expect(getData).toHaveBeenCalledOnce()
  },
)

it.each([
  "unknown_provider_code",
  "https://provider/?token=secret",
  "x".repeat(10_000),
])(
  "discards unknown SDK details at the untrusted browser boundary",
  async (code) => {
    fingerprintDiagnostics({}).browser({
      schema_version: 1,
      events: [
        {
          ...row,
          sdk_error_code: code,
          sdk_error_type: "Error containing a secret",
          message: "secret exception message",
          stack: "secret stack",
        },
      ],
    })
    await mocks.after.mock.calls[0][0]()
    const properties = mocks.batch.mock.calls[0][0][0].properties
    expect(properties).not.toHaveProperty("sdk_error_code")
    expect(properties).not.toHaveProperty("sdk_error_type")
    expect(properties).not.toHaveProperty("message")
    expect(properties).not.toHaveProperty("stack")
    expect(JSON.stringify(properties)).not.toContain("secret")
    expect(JSON.stringify(properties)).not.toContain(code)
  },
)
