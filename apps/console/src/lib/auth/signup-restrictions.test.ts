import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { mockTrackEvent, mockAfter } = vi.hoisted(() => ({
  mockTrackEvent: vi.fn(),
  mockAfter: vi.fn((callback: () => Promise<void>) => {
    void callback()
  }),
}))
vi.mock("next/server", () => ({ after: mockAfter }))
vi.mock("@/lib/cells", () => ({
  cellFor: (region: string) => ({ apiBaseUrl: `https://${region}.test` }),
}))
vi.mock("@/lib/posthog/actions", () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}))
vi.mock("@/lib/posthog/events", () => ({
  AUTH_EVENTS: { SIGNUP_RESTRICTION_EVALUATED: "restriction" },
}))

import {
  evaluateSignupRestriction,
  SignupRestrictedError,
} from "./signup-restrictions"

const previousToken = process.env.INTERNAL_API_TOKEN
const previousWestToken = process.env.INTERNAL_API_TOKEN_USWEST

beforeEach(() => {
  process.env.INTERNAL_API_TOKEN = "internal-secret"
  process.env.INTERNAL_API_TOKEN_USWEST = "west-secret"
  mockAfter.mockClear()
  mockTrackEvent.mockReset().mockResolvedValue(undefined)
})
afterEach(() => {
  vi.restoreAllMocks()
  if (previousToken === undefined) delete process.env.INTERNAL_API_TOKEN
  else process.env.INTERNAL_API_TOKEN = previousToken
  if (previousWestToken === undefined)
    delete process.env.INTERNAL_API_TOKEN_USWEST
  else process.env.INTERNAL_API_TOKEN_USWEST = previousWestToken
})

describe("signup restriction client", () => {
  it.each([
    ["off", "allowed", "none"],
    ["observe", "allowed", "none"],
    ["observe", "would_deny", "fingerprint"],
    ["enforce", "allowed", "none"],
  ])("allows a valid %s/%s decision", async (mode, decision, matched) => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        Response.json({ mode, decision, matched_subject_type: matched }),
      )
    await expect(
      evaluateSignupRestriction("use", "actor", "VisitorCase"),
    ).resolves.toBeUndefined()
    expect(fetchSpy).toHaveBeenCalledWith(
      new URL("https://use.test/internal/signup/evaluate"),
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer internal-secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          subjects: [{ type: "fingerprint", value: "VisitorCase" }],
        }),
      }),
    )
    expect(mockTrackEvent).toHaveBeenCalledWith("restriction", "actor", {
      outcome: decision,
      mode,
      subject_type: matched,
    })
  })

  it("denies only a valid blocked response and never puts the subject in telemetry", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        mode: "enforce",
        decision: "blocked",
        matched_subject_type: "fingerprint",
      }),
    )
    await expect(
      evaluateSignupRestriction("use", "actor", "VisitorCase"),
    ).rejects.toBeInstanceOf(SignupRestrictedError)
    expect(JSON.stringify(mockTrackEvent.mock.calls)).not.toContain(
      "VisitorCase",
    )
  })

  it("keeps blocked decision telemetry alive after the response and isolates flush failure", async () => {
    let scheduled: (() => Promise<void>) | undefined
    mockAfter.mockImplementationOnce((callback) => {
      scheduled = callback
    })
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        mode: "enforce",
        decision: "blocked",
        matched_subject_type: "fingerprint",
      }),
    )

    await expect(
      evaluateSignupRestriction("use", "actor", "VisitorCase"),
    ).rejects.toBeInstanceOf(SignupRestrictedError)
    expect(mockAfter).toHaveBeenCalledOnce()
    expect(mockTrackEvent).not.toHaveBeenCalled()

    mockTrackEvent.mockRejectedValueOnce(new Error("flush failed"))
    await expect(scheduled!()).resolves.toBeUndefined()
    expect(mockTrackEvent).toHaveBeenCalledWith("restriction", "actor", {
      outcome: "blocked",
      mode: "enforce",
      subject_type: "fingerprint",
    })
  })

  it("authenticates the west cell with its own token", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        mode: "enforce",
        decision: "blocked",
        matched_subject_type: "fingerprint",
      }),
    )
    await expect(
      evaluateSignupRestriction("usw", "actor", "VisitorCase"),
    ).rejects.toBeInstanceOf(SignupRestrictedError)
    expect(fetchSpy).toHaveBeenCalledWith(
      new URL("https://usw.test/internal/signup/evaluate"),
      expect.objectContaining({
        headers: {
          Authorization: "Bearer west-secret",
          "Content-Type": "application/json",
        },
      }),
    )
  })

  it("does not send the default token when the west token is missing", async () => {
    delete process.env.INTERNAL_API_TOKEN_USWEST
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    await expect(
      evaluateSignupRestriction("usw", "actor", "VisitorCase"),
    ).resolves.toBeUndefined()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(mockTrackEvent).toHaveBeenCalledWith("restriction", "actor", {
      outcome: "unavailable",
      mode: "unknown",
      subject_type: "none",
    })
  })

  it("does not call the service without the default cell token", async () => {
    delete process.env.INTERNAL_API_TOKEN
    const fetchSpy = vi.spyOn(globalThis, "fetch")

    await expect(
      evaluateSignupRestriction("use", "actor", "VisitorCase"),
    ).resolves.toBeUndefined()

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(mockTrackEvent).toHaveBeenCalledWith("restriction", "actor", {
      outcome: "unavailable",
      mode: "unknown",
      subject_type: "none",
    })
  })

  it("fails open after a transport failure without retrying", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new TypeError("network unavailable"))

    await expect(
      evaluateSignupRestriction("use", "actor", "VisitorCase"),
    ).resolves.toBeUndefined()

    expect(fetchSpy).toHaveBeenCalledOnce()
    expect(mockTrackEvent).toHaveBeenCalledWith("restriction", "actor", {
      outcome: "unavailable",
      mode: "unknown",
      subject_type: "none",
    })
  })

  it("bounds a stalled request to 1500 ms and does not retry after abort", async () => {
    const controller = new AbortController()
    const timeoutSpy = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(controller.signal)
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Timed out", "AbortError"))
          })
        }),
    )

    const evaluation = evaluateSignupRestriction("use", "actor", "VisitorCase")
    expect(timeoutSpy).toHaveBeenCalledOnce()
    expect(timeoutSpy).toHaveBeenCalledWith(1500)
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({ signal: controller.signal }),
    )

    controller.abort()
    await expect(evaluation).resolves.toBeUndefined()
    expect(fetchSpy).toHaveBeenCalledOnce()
    expect(mockTrackEvent).toHaveBeenCalledWith("restriction", "actor", {
      outcome: "unavailable",
      mode: "unknown",
      subject_type: "none",
    })
  })

  it.each([
    Response.json({
      mode: "enforce",
      decision: "blocked",
      matched_subject_type: "none",
    }),
    Response.json(
      {
        mode: "enforce",
        decision: "blocked",
        matched_subject_type: "fingerprint",
      },
      { status: 401 },
    ),
  ])("fails open for invalid or unavailable responses", async (response) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response)
    await expect(
      evaluateSignupRestriction("use", "actor", "VisitorCase"),
    ).resolves.toBeUndefined()
    expect(mockTrackEvent).toHaveBeenCalledWith("restriction", "actor", {
      outcome: "unavailable",
      mode: "unknown",
      subject_type: "none",
    })
  })

  it("fails open for an oversized response without accepting a blocked decision", async () => {
    const validBlocked = JSON.stringify({
      mode: "enforce",
      decision: "blocked",
      matched_subject_type: "fingerprint",
    })
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(`${validBlocked}${" ".repeat(4096)}`),
    )
    await expect(
      evaluateSignupRestriction("use", "actor", "VisitorCase"),
    ).resolves.toBeUndefined()
    expect(mockTrackEvent).toHaveBeenCalledWith("restriction", "actor", {
      outcome: "unavailable",
      mode: "unknown",
      subject_type: "none",
    })
  })

  it("fails open without evidence and does not call the service", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    await evaluateSignupRestriction("use", "actor", null)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
