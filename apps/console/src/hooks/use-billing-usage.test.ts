import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const useQuery = vi.fn((config) => config)
const useBillingContext = vi.fn()
const getBillingUsageSeries = vi.fn()
const getBillingPricing = vi.fn()
const runtimeTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone

vi.mock("@tanstack/react-query", () => ({
  useQuery,
}))

vi.mock("@/hooks/use-billing-context", () => ({
  useBillingContext: () => useBillingContext(),
}))

vi.mock("@/lib/api/billing-actions", () => ({
  getBillingUsageAction: vi.fn(),
}))

vi.mock("@/lib/api/billing", () => ({
  getBillingPricing,
  getBillingUsageSeries,
}))

describe("useBillingUsage", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useQuery.mockClear()
    getBillingUsageSeries.mockReset()
    useBillingContext.mockReset()
    useBillingContext.mockReturnValue({
      cacheScope: "self",
      teamKey: "use:team-a",
      ready: true,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

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
        queryKey: [
          "billing",
          "usage-series",
          "self",
          "use:team-a",
          "2026-01-02T00:00:00.000Z",
          "2026-01-02T23:30:00.000Z",
          "daily",
          runtimeTimezone,
        ],
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
        queryKey: [
          "billing",
          "usage-series",
          "self",
          "use:team-a",
          "2026-01-01T00:00:00.000Z",
          "2026-01-01T12:00:00.000Z",
          "daily",
          runtimeTimezone,
        ],
      }),
    )
    vi.useRealTimers()
  })

  it("changes the billing usage cache key when teams switch", async () => {
    const { useBillingUsage } = await import("./use-billing-usage")

    useBillingUsage(
      new Date("2026-01-01T00:00:00.000Z"),
      new Date("2026-01-01T12:00:00.000Z"),
    )

    useBillingContext.mockReturnValue({
      cacheScope: "self",
      teamKey: "use:team-b",
      ready: true,
    })

    useBillingUsage(
      new Date("2026-01-01T00:00:00.000Z"),
      new Date("2026-01-01T12:00:00.000Z"),
    )

    expect(useQuery.mock.calls[0]?.[0].queryKey).toEqual([
      "billing",
      "usage-series",
      "self",
      "use:team-a",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T12:00:00.000Z",
      "daily",
      runtimeTimezone,
    ])
    expect(useQuery.mock.calls[1]?.[0].queryKey).toEqual([
      "billing",
      "usage-series",
      "self",
      "use:team-b",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T12:00:00.000Z",
      "daily",
      runtimeTimezone,
    ])
  })

  it("keeps granularity and timezone in the series signature", async () => {
    const { useBillingUsage } = await import("./use-billing-usage")

    useBillingUsage(
      new Date("2026-01-01T00:00:00.000Z"),
      new Date("2026-01-08T00:00:00.000Z"),
      "weekly",
      "America/Chicago",
    )

    expect(useQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: [
          "billing",
          "usage-series",
          "self",
          "use:team-a",
          "2026-01-01T00:00:00.000Z",
          "2026-01-08T00:00:00.000Z",
          "weekly",
          "America/Chicago",
        ],
      }),
    )

    const queryConfig = useQuery.mock.calls.at(-1)?.[0]
    await queryConfig.queryFn()

    expect(getBillingUsageSeries).toHaveBeenCalledWith({
      start: "2026-01-01T00:00:00.000Z",
      end: "2026-01-08T00:00:00.000Z",
      granularity: "weekly",
      timezone: "America/Chicago",
    })
  })

  it("preserves the legacy enabled-only response contract", async () => {
    const { useBillingUsage } = await import("./use-billing-usage")

    useBillingUsage(
      new Date("2026-01-01T00:00:00.000Z"),
      new Date("2026-01-02T00:00:00.000Z"),
      true,
    )

    expect(useQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: [
          "billing",
          "usage",
          "self",
          "use:team-a",
          "2026-01-01T00:00:00.000Z",
          "2026-01-02T00:00:00.000Z",
        ],
        queryFn: expect.any(Function),
      }),
    )
  })
})

describe("useBillingSettings", () => {
  beforeEach(() => {
    useQuery.mockClear()
    getBillingPricing.mockReset()
    useBillingContext.mockReset()
  })

  it("uses authenticated pricing and waits for resolved billing context", async () => {
    useBillingContext.mockReturnValue({
      cacheScope: "impersonation:admin",
      teamKey: "usw:team-a",
      ready: true,
    })
    const { useBillingSettings } = await import("./use-billing-usage")

    useBillingSettings()

    expect(useQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        queryKey: ["billing", "settings", "impersonation:admin", "usw:team-a"],
        queryFn: getBillingPricing,
      }),
    )
  })

  it("does not enable pricing before the active team is resolved", async () => {
    useBillingContext.mockReturnValue({
      cacheScope: "self",
      teamKey: null,
      ready: false,
    })
    const { useBillingSettings } = await import("./use-billing-usage")

    useBillingSettings()

    expect(useQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: false,
        queryKey: ["billing", "settings", "self", "unresolved"],
      }),
    )
  })
})
