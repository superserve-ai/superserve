import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mockConsumeAuthRateLimit = vi.fn()
const mockConsumeAuthRateLimitOutcome = vi.fn()
const mockSendToSlack = vi.fn()

vi.mock("@/lib/auth/rate-limit", () => ({
  consumeAuthRateLimit: (...args: unknown[]) =>
    mockConsumeAuthRateLimit(...args),
  consumeAuthRateLimitOutcome: (...args: unknown[]) =>
    mockConsumeAuthRateLimitOutcome(...args),
}))

vi.mock("@/lib/slack/send-to-webhook", () => ({
  default: (...args: unknown[]) => mockSendToSlack(...args),
}))

import {
  recoveryClientNetworkKey,
  recoveryEmailHourlyLimit,
  reserveRecoveryEmail,
  takeRecoveryNetworkLimit,
} from "./recovery-email-limits"

const CALLER = {
  userId: "user-1",
  email: "User@Example.COM",
}

describe("recovery email limits", () => {
  beforeEach(() => {
    mockConsumeAuthRateLimit.mockReset().mockResolvedValue(true)
    mockConsumeAuthRateLimitOutcome.mockReset().mockResolvedValue("allowed")
    mockSendToSlack.mockReset().mockResolvedValue({ success: true })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("allows one recovery token per address per minute, ignoring case", async () => {
    mockConsumeAuthRateLimit.mockImplementation(
      async (limit: { bucket: string }) =>
        limit.bucket !== "recovery_email_cooldown",
    )

    expect(await reserveRecoveryEmail(CALLER)).toBe("cooldown")
    expect(mockConsumeAuthRateLimit).toHaveBeenLastCalledWith(
      { bucket: "recovery_email_cooldown", max: 1, windowSeconds: 60 },
      "user@example.com",
    )
    // The account allowance is untouched by a request inside the minute.
    expect(mockConsumeAuthRateLimit).not.toHaveBeenCalledWith(
      expect.objectContaining({ bucket: "recovery_email_account" }),
      expect.anything(),
    )
    expect(mockConsumeAuthRateLimitOutcome).not.toHaveBeenCalled()
  })

  it("defaults to a backstop of 100 emails per hour", () => {
    vi.stubEnv("AUTH_RECOVERY_EMAILS_PER_HOUR", "")
    expect(recoveryEmailHourlyLimit()).toEqual({
      bucket: "recovery_email_project",
      max: 100,
      windowSeconds: 3600,
    })
  })

  it("reads the hourly budget from the environment", () => {
    vi.stubEnv("AUTH_RECOVERY_EMAILS_PER_HOUR", " 120 ")
    expect(recoveryEmailHourlyLimit().max).toBe(120)
  })

  it.each(["0", "-5", "1.5", "abc", "1e3", "100001"])(
    "ignores an invalid hourly budget of %j",
    (value) => {
      vi.stubEnv("AUTH_RECOVERY_EMAILS_PER_HOUR", value)
      expect(recoveryEmailHourlyLimit().max).toBe(100)
    },
  )

  it.each([
    ["203.0.113.7", "203.0.113.7"],
    [" 203.0.113.7 ", "203.0.113.7"],
    ["2001:db8:1:2:aaaa:bbbb:cccc:dddd", "2001:db8:1:2::/64"],
    ["2001:DB8:1:2::7", "2001:db8:1:2::/64"],
    ["2001:0db8:0001:0002:0000:0000:0000:0001", "2001:db8:1:2::/64"],
    ["2001:db8::1", "2001:db8:0:0::/64"],
    ["::1", "0:0:0:0::/64"],
    ["::ffff:198.51.100.4", "198.51.100.4"],
    ["::ffff:c633:6404", "198.51.100.4"],
    ["64:ff9b::198.51.100.4", "64:ff9b:0:0::/64"],
    ["not-an-ip", "not-an-ip"],
  ])("keys client %j by network as %j", (ip, key) => {
    expect(recoveryClientNetworkKey(ip)).toBe(key)
  })

  it("takes the caller's network limit by /64, and skips it with no client IP", async () => {
    expect(await takeRecoveryNetworkLimit("2001:db8:1:2::9")).toBe(true)
    expect(mockConsumeAuthRateLimit).toHaveBeenCalledExactlyOnceWith(
      { bucket: "recovery_email_ip", max: 10, windowSeconds: 3600 },
      "2001:db8:1:2::/64",
    )

    mockConsumeAuthRateLimit.mockClear()
    expect(await takeRecoveryNetworkLimit(undefined)).toBe(true)
    expect(mockConsumeAuthRateLimit).not.toHaveBeenCalled()
  })

  it("refuses once the caller's network limit is used up", async () => {
    mockConsumeAuthRateLimit.mockResolvedValue(false)

    expect(await takeRecoveryNetworkLimit("203.0.113.7")).toBe(false)
  })

  it("takes the cooldown, the account limit, then the project budget", async () => {
    expect(await reserveRecoveryEmail(CALLER)).toBe("reserved")
    expect(mockConsumeAuthRateLimit.mock.calls).toEqual([
      [
        { bucket: "recovery_email_cooldown", max: 1, windowSeconds: 60 },
        "user@example.com",
      ],
      [
        { bucket: "recovery_email_account", max: 5, windowSeconds: 3600 },
        "user-1",
      ],
    ])
    expect(mockConsumeAuthRateLimitOutcome).toHaveBeenCalledExactlyOnceWith(
      { bucket: "recovery_email_project", max: 100, windowSeconds: 3600 },
      "project",
    )
  })

  it("takes the caller's address limit before the cooldown", async () => {
    const addressLimit = {
      bucket: "password_reset_email",
      max: 3,
      windowSeconds: 900,
    }

    expect(await reserveRecoveryEmail({ ...CALLER, addressLimit })).toBe(
      "reserved",
    )
    expect(
      mockConsumeAuthRateLimit.mock.calls.map(([limit, key]) => [
        limit.bucket,
        key,
      ]),
    ).toEqual([
      ["password_reset_email", "user@example.com"],
      ["recovery_email_cooldown", "user@example.com"],
      ["recovery_email_account", "user-1"],
    ])
  })

  it("refuses at the caller's address limit without starting the cooldown", async () => {
    mockConsumeAuthRateLimit.mockImplementation(
      async (limit: { bucket: string }) =>
        limit.bucket !== "password_reset_email",
    )

    expect(
      await reserveRecoveryEmail({
        ...CALLER,
        addressLimit: {
          bucket: "password_reset_email",
          max: 3,
          windowSeconds: 900,
        },
      }),
    ).toBe("address_limit")
    expect(mockConsumeAuthRateLimit).not.toHaveBeenCalledWith(
      expect.objectContaining({ bucket: "recovery_email_cooldown" }),
      expect.anything(),
    )
  })

  it.each([
    ["recovery_email_cooldown", "cooldown"],
    ["recovery_email_account", "account_limit"],
  ])(
    "stops at %s without touching the project budget",
    async (bucket, expected) => {
      mockConsumeAuthRateLimit.mockImplementation(
        async (limit: { bucket: string }) => limit.bucket !== bucket,
      )

      expect(await reserveRecoveryEmail(CALLER)).toBe(expected)
      expect(mockConsumeAuthRateLimitOutcome).not.toHaveBeenCalled()
    },
  )

  it("retries with backoff while a concurrent send holds the project key", async () => {
    vi.useFakeTimers()
    mockConsumeAuthRateLimitOutcome
      .mockResolvedValueOnce("busy")
      .mockResolvedValueOnce("busy")
      .mockResolvedValueOnce("busy")
      .mockResolvedValueOnce("allowed")

    const pending = reserveRecoveryEmail(CALLER)
    await vi.advanceTimersByTimeAsync(50 + 100)
    expect(mockConsumeAuthRateLimitOutcome).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(200)

    expect(await pending).toBe("reserved")
    expect(mockConsumeAuthRateLimitOutcome).toHaveBeenCalledTimes(4)
  })

  it("gives up after the last retry when the project key stays busy", async () => {
    vi.useFakeTimers()
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    mockConsumeAuthRateLimitOutcome.mockResolvedValue("busy")

    const pending = reserveRecoveryEmail(CALLER)
    await vi.runAllTimersAsync()

    expect(await pending).toBe("budget_busy")
    expect(mockConsumeAuthRateLimitOutcome).toHaveBeenCalledTimes(6)
    expect(consoleError).toHaveBeenCalledWith(
      "Recovery email budget stayed busy; email not sent",
    )
    expect(mockSendToSlack).not.toHaveBeenCalled()
  })

  it("does not retry, and alerts, once the budget is used up", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    mockConsumeAuthRateLimitOutcome.mockResolvedValue("refused")

    expect(await reserveRecoveryEmail(CALLER)).toBe("budget_used_up")
    expect(mockConsumeAuthRateLimitOutcome).toHaveBeenCalledOnce()
    expect(consoleError).toHaveBeenCalledWith(
      "Recovery email hourly budget used up:",
      100,
    )
    expect(mockConsumeAuthRateLimit).toHaveBeenLastCalledWith(
      { bucket: "recovery_email_budget_alert", max: 1, windowSeconds: 3600 },
      "project",
    )
    expect(mockSendToSlack).toHaveBeenCalledExactlyOnceWith({
      text: expect.stringContaining("AUTH_RECOVERY_EMAILS_PER_HOUR"),
    })
  })

  it("sends at most one budget alert per hour", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    mockConsumeAuthRateLimitOutcome.mockResolvedValue("refused")
    mockConsumeAuthRateLimit.mockImplementation(
      async (limit: { bucket: string }) =>
        limit.bucket !== "recovery_email_budget_alert",
    )

    expect(await reserveRecoveryEmail(CALLER)).toBe("budget_used_up")
    expect(mockSendToSlack).not.toHaveBeenCalled()
  })

  it("still refuses when the budget alert fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    mockConsumeAuthRateLimitOutcome.mockResolvedValue("refused")
    mockSendToSlack.mockRejectedValue(new Error("slack down"))

    expect(await reserveRecoveryEmail(CALLER)).toBe("budget_used_up")
    expect(consoleError).toHaveBeenCalledWith(
      "Recovery email budget alert failed:",
      expect.any(Error),
    )
  })
})
