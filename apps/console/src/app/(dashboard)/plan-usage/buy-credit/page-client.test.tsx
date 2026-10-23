import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { dollarsToCents, formatDollars } from "./page-client"

vi.mock("@/hooks/use-pricing-version", () => ({
  usePricingVersion: vi.fn(),
}))
vi.mock("../page-client", () => ({
  PlanUsagePageClient: () => <p>plan and usage</p>,
}))
vi.mock("./page-client", async (original) => ({
  ...(await original<typeof import("./page-client")>()),
  BuyCreditPageClient: () => <p>buy credit</p>,
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

  it("formats whole and fractional dollars", () => {
    expect(formatDollars(2500)).toBe("$25")
    expect(formatDollars(1234)).toBe("$12.34")
  })
})

describe("buy credit route", () => {
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
