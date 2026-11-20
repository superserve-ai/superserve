// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mockTrackEvent = vi.hoisted(() => vi.fn())
const afterQueue = vi.hoisted(() => [] as Array<() => unknown>)
const cookieStore = vi.hoisted(() => ({
  get: vi.fn(),
  delete: vi.fn(),
}))
const mockHeaders = vi.hoisted(() => vi.fn())

vi.mock("@/lib/posthog/actions", () => ({ trackEvent: mockTrackEvent }))
vi.mock("next/server", () => ({
  after: (callback: () => unknown) => {
    afterQueue.push(callback)
  },
}))
vi.mock("next/headers", () => ({
  cookies: async () => cookieStore,
  headers: mockHeaders,
}))

import {
  heedeoRequestContext,
  heedeoResponseProperty,
  type HeedeoSignupObservation,
  observeHeedeoSignup,
  readHeedeoRequestContext,
  scheduleHeedeoCaptureDiscarded,
  scheduleHeedeoSignupObservation,
  takeHeedeoSignupCapture,
} from "./observe"
import { encodeHeedeoCapture } from "./shared"

const ANSWER = {
  flagged: true,
  no_token: false,
  flag: true,
  score: 150,
  threshold: 100,
  thresholds: { verify: 60, review: 100, block: null, action: null },
  suggested: "review",
  decision: {
    flag: true,
    band: "review",
    score: 150,
    risk: "account_abuse",
    by: "risk",
    judged: ["account_abuse"],
  },
  risks: { account_abuse: { score: 150, judged: true, reasons: [] } },
  version: null,
  reasons: [
    {
      code: "repeat_action",
      text: "signup already done",
      weight: 100,
      base: 100,
    },
    { code: "many_identities", text: "2 identities", weight: 50, base: 50 },
  ],
  visitor: { id: "613d", confidence: 1, browsers: [], aliases: [] },
  related: [],
  account: null,
  counts: { "24h": 2, "7d": 2 },
  activity: { last_hour: 2, hourly_norm: 0.4, burst: false },
  listed: null,
  email: { disposable: false, free_provider: true },
  network: { vpn: false, country: "US", asn: "AS7922" },
  agent: null,
  environment: { tampered: false, private_mode: false },
  event_id: "79c7",
  undocumented_field: "dropped",
}

function observation(
  overrides: Partial<HeedeoSignupObservation> = {},
): HeedeoSignupObservation {
  return {
    signupAttemptId: "attempt-1",
    signupMethod: "email",
    email: "new@example.com",
    userId: "user-1",
    status: "succeeded",
    capture: { status: "ok", token: "ct1.token", latencyMs: 640 },
    request: {
      clientIp: "203.0.113.7",
      headers: {
        "user-agent": "UA",
        ":method": "POST",
        ":path": "/auth/signup/",
      },
    },
    ...overrides,
  }
}

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  })

beforeEach(() => {
  process.env.HEEDEO_SECRET_KEY = "sk_test_secret"
  vi.spyOn(console, "info").mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  mockTrackEvent.mockReset()
  cookieStore.get.mockReset()
  cookieStore.delete.mockReset()
  mockHeaders.mockReset()
  afterQueue.length = 0
  delete process.env.HEEDEO_SECRET_KEY
  delete process.env.HEEDEO_SIGNUP_OBSERVATION
})

describe("observeHeedeoSignup", () => {
  it("sends one signup event and records Heedeo's answer", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      json(ANSWER, { headers: { "heedeo-trace-id": "trace-1" } }),
    )
    await observeHeedeoSignup(observation(), fetchMock)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe("https://app.heedeo.com/v1/evaluations")
    const headers = new Headers(init?.headers)
    expect(headers.get("authorization")).toBe("Bearer sk_test_secret")
    expect(headers.get("heedeo-version")).toBe("2026-11-08")
    expect(JSON.parse(String(init?.body))).toEqual({
      action: "signup",
      token: "ct1.token",
      email: "new@example.com",
      user_id: "user-1",
      client_ip: "203.0.113.7",
      headers: {
        "user-agent": "UA",
        ":method": "POST",
        ":path": "/auth/signup/",
      },
      request_id: "attempt-1",
      status: "succeeded",
    })

    expect(mockTrackEvent).toHaveBeenCalledTimes(1)
    const [event, distinctId, props] = mockTrackEvent.mock.calls[0]!
    expect(event).toBe("auth_heedeo_signup_observed")
    expect(distinctId).toBe("user-1")
    expect(props).toMatchObject({
      provider: "heedeo",
      mode: "observe",
      signup_attempt_id: "attempt-1",
      signup_method: "email",
      signup_status: "succeeded",
      superserve_user_id: "user-1",
      capture_status: "ok",
      capture_latency_ms: 640,
      token_present: true,
      provider_outcome: "success",
      provider_http_status: 200,
      provider_trace_id: "trace-1",
      provider_attempts: 1,
      heedeo_event_id: "79c7",
      heedeo_visitor_id: "613d",
      flagged: true,
      no_token: false,
      flag: true,
      score: 150,
      threshold: 100,
      band: "review",
      decision_risk: "account_abuse",
      decision_by: "risk",
      listed: null,
      visitor_confidence: 1,
      reason_codes: ["repeat_action", "many_identities"],
    })
    expect(typeof props.provider_latency_ms).toBe("number")
    expect(props.heedeo_response.network).toEqual(ANSWER.network)
    expect(props.heedeo_response.reasons).toEqual(ANSWER.reasons)
    expect(props.heedeo_response).not.toHaveProperty("undocumented_field")
    // The token and email never go to analytics.
    expect(JSON.stringify(props)).not.toContain("ct1.token")
    expect(JSON.stringify(props)).not.toContain("new@example.com")
    // The log line alone links the evidence to the account.
    expect(console.info).toHaveBeenCalledWith(
      "Heedeo signup observation outcome",
      expect.objectContaining({
        signup_attempt_id: "attempt-1",
        superserve_user_id: "user-1",
        heedeo_visitor_id: "613d",
      }),
    )
  })

  it("still sends the event without a token, with the capture status", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      json({ ...ANSWER, no_token: true }),
    )
    await observeHeedeoSignup(
      observation({
        capture: { status: "script_failed", token: null, latencyMs: 12 },
        userId: null,
        status: "failed",
      }),
      fetchMock,
    )
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body))
    expect(body).not.toHaveProperty("token")
    expect(body).not.toHaveProperty("user_id")
    expect(body.status).toBe("failed")
    const [, distinctId, props] = mockTrackEvent.mock.calls[0]!
    expect(distinctId).toBe("attempt-1")
    expect(props).toMatchObject({
      capture_status: "script_failed",
      token_present: false,
      no_token: true,
    })
    expect(console.info).toHaveBeenCalledWith(
      "Heedeo signup observation outcome",
      expect.objectContaining({
        signup_attempt_id: "attempt-1",
        superserve_user_id: null,
      }),
    )
  })

  it("records a missing capture as absent", async () => {
    await observeHeedeoSignup(
      observation({ capture: null }),
      vi.fn<typeof fetch>(async () => json(ANSWER)),
    )
    expect(mockTrackEvent.mock.calls[0]![2].capture_status).toBe("absent")
  })

  it("sends Google's verified email as OAuth evidence", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => json(ANSWER))
    await observeHeedeoSignup(
      observation({ signupMethod: "google", oauthEmailVerified: true }),
      fetchMock,
    )
    expect(
      JSON.parse(String(fetchMock.mock.calls[0]![1]?.body)).evidence,
    ).toEqual({ oauth: { provider: "google", email_verified: true } })
  })

  it("retries a 5xx once and records the outcome", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      json({ error: { code: "internal" } }, { status: 500 }),
    )
    await observeHeedeoSignup(observation(), fetchMock)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(mockTrackEvent.mock.calls[0]![2]).toMatchObject({
      provider_outcome: "http_500",
      provider_error_code: "internal",
      provider_attempts: 2,
      flagged: null,
      score: null,
      heedeo_response: null,
    })
  })

  it("does not retry a 4xx and keeps only a safe error code", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      json({ error: { code: "Invalid Key <b>" } }, { status: 401 }),
    )
    await observeHeedeoSignup(observation(), fetchMock)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(mockTrackEvent.mock.calls[0]![2]).toMatchObject({
      provider_outcome: "http_401",
      provider_error_code: null,
    })
  })

  it("records a malformed answer", async () => {
    await observeHeedeoSignup(
      observation(),
      vi.fn<typeof fetch>(async () => new Response("not json")),
    )
    expect(mockTrackEvent.mock.calls[0]![2].provider_outcome).toBe("malformed")
  })

  it("records an answer over the size limit as malformed", async () => {
    const huge = JSON.stringify({ ...ANSWER, padding: "x".repeat(300_000) })
    await observeHeedeoSignup(
      observation(),
      vi.fn<typeof fetch>(async () => new Response(huge)),
    )
    expect(mockTrackEvent.mock.calls[0]![2].provider_outcome).toBe("malformed")
  })

  it("records a timeout within the budget", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(init.signal?.reason),
          )
        }),
    )
    const started = Date.now()
    await observeHeedeoSignup(observation(), fetchMock)
    expect(Date.now() - started).toBeLessThan(4000)
    expect(mockTrackEvent.mock.calls[0]![2].provider_outcome).toBe("timeout")
  })

  it("does nothing when off", async () => {
    const fetchMock = vi.fn<typeof fetch>()
    process.env.HEEDEO_SIGNUP_OBSERVATION = "off"
    await observeHeedeoSignup(observation(), fetchMock)
    delete process.env.HEEDEO_SIGNUP_OBSERVATION
    delete process.env.HEEDEO_SECRET_KEY
    await observeHeedeoSignup(observation(), fetchMock)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mockTrackEvent).not.toHaveBeenCalled()
  })

  it("never throws, even when analytics fails", async () => {
    mockTrackEvent.mockRejectedValue(new Error("posthog down"))
    await expect(
      observeHeedeoSignup(
        observation(),
        vi.fn<typeof fetch>(async () => json(ANSWER)),
      ),
    ).resolves.toBeUndefined()
    await expect(
      observeHeedeoSignup(
        observation(),
        vi.fn<typeof fetch>(async () => {
          throw new TypeError("fetch failed")
        }),
      ),
    ).resolves.toBeUndefined()
  })
})

describe("heedeoResponseProperty", () => {
  it("bounds a large answer", () => {
    const big = {
      ...ANSWER,
      related: Array.from({ length: 500 }, (_, i) => ({
        visitor_id: `v${i}`,
        link: "x".repeat(2000),
      })),
      visitor: {
        id: "613d",
        browsers: Array.from({ length: 100 }, () => ({
          evidence: "y".repeat(2000),
        })),
      },
    }
    const kept = heedeoResponseProperty(big)
    expect(JSON.stringify(kept).length).toBeLessThanOrEqual(32_000)
    expect(kept.event_id).toBe("79c7")
  })
})

describe("scheduleHeedeoSignupObservation", () => {
  it("runs after the response and reads a lazy observation then", async () => {
    let userId: string | null = null
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => json(ANSWER))
    scheduleHeedeoSignupObservation(() => observation({ userId }))
    expect(fetchMock).not.toHaveBeenCalled()
    userId = "created-later"
    await Promise.all(afterQueue.splice(0).map((callback) => callback()))
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body)).user_id).toBe(
      "created-later",
    )
  })

  it("schedules nothing when off", () => {
    delete process.env.HEEDEO_SECRET_KEY
    scheduleHeedeoSignupObservation(observation())
    expect(afterQueue).toHaveLength(0)
  })
})

describe("scheduleHeedeoCaptureDiscarded", () => {
  it("counts a dropped capture after the response, without its token", async () => {
    scheduleHeedeoCaptureDiscarded({
      signupAttemptId: "attempt-1",
      userId: "user-1",
      capture: { status: "ok", token: "ct1.token", latencyMs: 640 },
    })
    expect(mockTrackEvent).not.toHaveBeenCalled()
    await Promise.all(afterQueue.splice(0).map((callback) => callback()))
    const [event, distinctId, props] = mockTrackEvent.mock.calls[0]!
    expect(event).toBe("auth_heedeo_capture_discarded")
    expect(distinctId).toBe("user-1")
    expect(props).toMatchObject({
      reason: "existing_account",
      signup_attempt_id: "attempt-1",
      capture_status: "ok",
      token_present: true,
    })
    expect(JSON.stringify(props)).not.toContain("ct1.token")
  })
})

describe("takeHeedeoSignupCapture", () => {
  it("reads and deletes the browser's capture", async () => {
    cookieStore.get.mockReturnValue({
      value: encodeHeedeoCapture({
        status: "ok",
        token: "ct1.t",
        latencyMs: 9,
      }),
    })
    await expect(takeHeedeoSignupCapture()).resolves.toEqual({
      status: "ok",
      token: "ct1.t",
      latencyMs: 9,
    })
    expect(cookieStore.delete).toHaveBeenCalledWith({
      name: "superserve-heedeo-signup",
      path: "/auth",
    })
  })

  it("returns null without a cookie or with a bad one", async () => {
    cookieStore.get.mockReturnValue(undefined)
    await expect(takeHeedeoSignupCapture()).resolves.toBeNull()
    cookieStore.get.mockReturnValue({ value: "garbage" })
    await expect(takeHeedeoSignupCapture()).resolves.toBeNull()
    cookieStore.get.mockImplementation(() => {
      throw new Error("no request scope")
    })
    await expect(takeHeedeoSignupCapture()).resolves.toBeNull()
  })
})

describe("heedeoRequestContext", () => {
  it("forwards only the headers Heedeo reads, never cookies or authorization", () => {
    vi.stubEnv("VERCEL", "1")
    const context = heedeoRequestContext(
      new Headers({
        host: "console.superserve.ai",
        "user-agent": "UA",
        "accept-language": "en",
        cookie: "sb-access-token=secret",
        authorization: "Bearer x",
        "x-real-ip": "203.0.113.7",
        "cf-connecting-ip": "198.51.100.1",
      }),
      "POST",
      "/auth/signup/",
    )
    expect(context.clientIp).toBe("203.0.113.7")
    expect(context.headers).toEqual({
      ":method": "POST",
      ":path": "/auth/signup/",
      ":forwarded": expect.stringContaining("user-agent"),
      host: "console.superserve.ai",
      "user-agent": "UA",
      "accept-language": "en",
    })
  })

  it("reads the server action's request, or null outside one", async () => {
    mockHeaders.mockResolvedValue(new Headers({ "user-agent": "UA" }))
    await expect(
      readHeedeoRequestContext("/auth/signup/"),
    ).resolves.toMatchObject({
      headers: { "user-agent": "UA", ":path": "/auth/signup/" },
    })
    mockHeaders.mockRejectedValue(new Error("outside a request"))
    await expect(readHeedeoRequestContext("/auth/signup/")).resolves.toBeNull()
  })
})
