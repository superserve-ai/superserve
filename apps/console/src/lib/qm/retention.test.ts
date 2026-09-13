import { afterEach, describe, expect, it, vi } from "vitest"

import { qmRetentionDays } from "./retention"

describe("qmRetentionDays", () => {
  afterEach(() => vi.unstubAllEnvs())

  it("promises nothing unless a positive whole number of days is configured", () => {
    vi.stubEnv("NEXT_PUBLIC_QM_RETENTION_DAYS", "")
    expect(qmRetentionDays()).toBeNull()
    vi.stubEnv("NEXT_PUBLIC_QM_RETENTION_DAYS", "0")
    expect(qmRetentionDays()).toBeNull()
    vi.stubEnv("NEXT_PUBLIC_QM_RETENTION_DAYS", "seven")
    expect(qmRetentionDays()).toBeNull()
    vi.stubEnv("NEXT_PUBLIC_QM_RETENTION_DAYS", "7")
    expect(qmRetentionDays()).toBe(7)
  })
})
