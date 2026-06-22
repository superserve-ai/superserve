import { describe, expect, it, vi } from "vitest"

const useQuery = vi.fn((config) => config)

vi.mock("@tanstack/react-query", () => ({
  useQuery,
}))

vi.mock("@/lib/api/billing-actions", () => ({
  getBillingSettingsAction: vi.fn(),
  getBillingUsageAction: vi.fn(),
}))

describe("useBillingUsage", () => {
  it("polls recent ranges every minute", async () => {
    vi.setSystemTime(new Date("2026-01-03T00:00:00.000Z"))
    const { useBillingUsage } = await import("./use-billing-usage")

    useBillingUsage(
      new Date("2026-01-02T00:00:00.000Z"),
      new Date("2026-01-02T23:30:00.000Z"),
    )

    expect(useQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        staleTime: 30_000,
        refetchInterval: 60_000,
      }),
    )
    vi.useRealTimers()
  })

  it("caches historical ranges without polling", async () => {
    useQuery.mockClear()
    vi.setSystemTime(new Date("2026-01-03T00:00:00.000Z"))
    const { useBillingUsage } = await import("./use-billing-usage")

    useBillingUsage(
      new Date("2026-01-01T00:00:00.000Z"),
      new Date("2026-01-01T12:00:00.000Z"),
    )

    expect(useQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        staleTime: 30 * 60_000,
        refetchInterval: false,
      }),
    )
    vi.useRealTimers()
  })
})
