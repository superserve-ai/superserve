import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mockConsumeAuthRateLimit = vi.fn()

vi.mock("@/lib/auth/rate-limit", () => ({
  consumeAuthRateLimit: (...args: unknown[]) =>
    mockConsumeAuthRateLimit(...args),
}))

import {
  recoveryEmailHourlyLimit,
  reserveRecoveryEmail,
  startRecoveryEmailCooldown,
} from "./recovery-email-limits"

describe("recovery email limits", () => {
  beforeEach(() => {
    mockConsumeAuthRateLimit.mockReset().mockResolvedValue(true)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("allows one recovery token per address per minute, ignoring case", async () => {
    mockConsumeAuthRateLimit.mockResolvedValueOnce(false)

    expect(await startRecoveryEmailCooldown("User@Example.COM")).toBe(false)
    expect(mockConsumeAuthRateLimit).toHaveBeenCalledExactlyOnceWith(
      { bucket: "recovery_email_cooldown", max: 1, windowSeconds: 60 },
      "user@example.com",
    )
  })

  it("defaults to Supabase Auth's 30 emails per hour", () => {
    vi.stubEnv("AUTH_RECOVERY_EMAILS_PER_HOUR", "")
    expect(recoveryEmailHourlyLimit()).toEqual({
      bucket: "recovery_email_project",
      max: 30,
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
      expect(recoveryEmailHourlyLimit().max).toBe(30)
    },
  )

  it("shares one project-wide key for the hourly budget", async () => {
    expect(await reserveRecoveryEmail()).toBe(true)
    expect(mockConsumeAuthRateLimit).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ bucket: "recovery_email_project" }),
      "project",
    )
  })

  it("tries once more when a concurrent send holds the key", async () => {
    vi.useFakeTimers()
    mockConsumeAuthRateLimit.mockResolvedValueOnce(false)

    const pending = reserveRecoveryEmail()
    await vi.runAllTimersAsync()

    expect(await pending).toBe(true)
    expect(mockConsumeAuthRateLimit).toHaveBeenCalledTimes(2)
  })

  it("refuses and logs once the budget is used up", async () => {
    vi.useFakeTimers()
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    mockConsumeAuthRateLimit.mockResolvedValue(false)

    const pending = reserveRecoveryEmail()
    await vi.runAllTimersAsync()

    expect(await pending).toBe(false)
    expect(mockConsumeAuthRateLimit).toHaveBeenCalledTimes(2)
    expect(consoleError).toHaveBeenCalledWith(
      "Recovery email hourly budget used up:",
      30,
    )
  })
})
