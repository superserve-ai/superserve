import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { dollarsToCents, formatDollars, requestedAmount } from "./page-client"

vi.mock("@/hooks/use-pricing-version", () => ({
  usePricingVersion: vi.fn(),
}))
const prepaid = vi.hoisted(() => ({
  data: {
    purchases: [] as { state: string }[],
    auto_recharge: { enabled: false },
    balance_cents: 5000,
    has_saved_card: true,
  },
  isLoading: false,
  error: null as Error | null,
  retained: [] as unknown[],
}))
vi.mock("@/hooks/use-prepaid-credit", () => ({
  usePrepaidCredit: () => prepaid,
  useRetainedPrepaidOperations: () => prepaid.retained,
}))
vi.mock("../page-client", () => ({
  PlanUsagePageClient: () => <p>plan and usage</p>,
}))
vi.mock("./page-client", async (original) => ({
  ...(await original<typeof import("./page-client")>()),
  BuyCreditPageClient: ({ allowEntry = true }: { allowEntry?: boolean }) => (
    <p>{allowEntry ? "buy credit" : "read and disable credit"}</p>
  ),
}))

import { usePricingVersion } from "@/hooks/use-pricing-version"

import { BuyCreditRoute } from "./route-client"

describe("buy credit amounts", () => {
  it("parses dollar input to cents and rejects anything else", () => {
    expect(dollarsToCents("75")).toBe(7500)
    expect(dollarsToCents("5.00")).toBe(500)
    expect(dollarsToCents("5.5.5")).toBeNull()
    expect(dollarsToCents("-5")).toBeNull()
    expect(dollarsToCents("1e3")).toBeNull()
  })

  it("preselects a requested amount only when it is a valid purchase", () => {
    expect(requestedAmount("5000")).toEqual({ preset: 5000, custom: "" })
    expect(requestedAmount("7500")).toEqual({ preset: 2500, custom: "75" })
    expect(requestedAmount("750")).toEqual({ preset: 2500, custom: "" })
    expect(requestedAmount(null)).toEqual({ preset: 2500, custom: "" })
  })

  it("formats whole and fractional dollars", () => {
    expect(formatDollars(2500)).toBe("$25")
    expect(formatDollars(1234)).toBe("$12.34")
  })
})

describe("buy credit route", () => {
  beforeEach(() => {
    prepaid.data.purchases = []
    prepaid.data.balance_cents = 0
    prepaid.data.auto_recharge.enabled = false
    prepaid.isLoading = false
    prepaid.error = null
    prepaid.retained = []
  })

  it.each(["legacy", null] as const)(
    "keeps existing recharge exit available when pricing is %s",
    (version) => {
      vi.mocked(usePricingVersion).mockReturnValue(version)
      prepaid.data.auto_recharge.enabled = true
      render(<BuyCreditRoute />)
      expect(screen.getByText("read and disable credit")).toBeTruthy()
      expect(screen.queryByText("buy credit")).toBeNull()
    },
  )

  it.each(["legacy", null] as const)(
    "keeps a positive balance readable without purchase history when pricing is %s",
    (version) => {
      vi.mocked(usePricingVersion).mockReturnValue(version)
      prepaid.data.balance_cents = 5000
      render(<BuyCreditRoute />)
      expect(screen.getByText("read and disable credit")).toBeTruthy()
      expect(screen.queryByText("plan and usage")).toBeNull()
      expect(screen.queryByText("buy credit")).toBeNull()
    },
  )

  it("keeps a lost-response operation reachable after entry closes even without backend history", () => {
    vi.mocked(usePricingVersion).mockReturnValue("legacy")
    prepaid.retained = [{ id: "retained" }]
    render(<BuyCreditRoute />)
    expect(screen.getByText("read and disable credit")).toBeTruthy()
  })

  it("keeps purchased credit readable after pricing switches off", () => {
    vi.mocked(usePricingVersion).mockReturnValue("legacy")
    prepaid.data.purchases = [{ state: "credited" }]
    render(<BuyCreditRoute />)
    expect(screen.getByText("read and disable credit")).toBeTruthy()
  })

  it("shows an error when pricing cannot be loaded", () => {
    vi.mocked(usePricingVersion).mockReturnValue(null)
    render(<BuyCreditRoute />)
    expect(screen.getByRole("alert").textContent).toContain(
      "Pricing is unavailable",
    )
    expect(screen.queryByText("buy credit")).toBeNull()
  })

  it("shows the existing plan and usage page while pricing v2 is off", () => {
    vi.mocked(usePricingVersion).mockReturnValue("legacy")
    render(<BuyCreditRoute />)
    expect(screen.getByText("plan and usage")).toBeTruthy()
    expect(screen.queryByText("buy credit")).toBeNull()
  })

  it("shows the purchase page once pricing v2 is on", () => {
    vi.mocked(usePricingVersion).mockReturnValue("v2")
    render(<BuyCreditRoute />)
    expect(screen.getByText("buy credit")).toBeTruthy()
  })
})
