import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { BillingOffer } from "@/lib/billing/plans"

const mocks = vi.hoisted(() => ({
  offers: null as BillingOffer[] | null,
  load: vi.fn(),
}))
vi.mock("@/lib/billing/plan-offers-actions", () => ({
  getTeamOffersAction: async (locator: unknown) => {
    mocks.load(locator)
    return mocks.offers
  },
}))

const locator = { account: "account-1", team: "use:team-1" }

import { PlanPickerOptions } from "./plan-picker-options"

const offer = (
  offer_key: string,
  display_name: string,
  extra: Partial<BillingOffer> = {},
): BillingOffer => ({
  offer_key,
  family: offer_key.split("_")[0]!,
  display_name,
  price_cents: 1100,
  interval_months: 1,
  included_credit_cents: 1100,
  funding_policy: "postpaid",
  topoff: null,
  sellable: true,
  ...extra,
})

afterEach(cleanup)

describe("PlanPickerOptions", () => {
  it("renders catalog offers with their terms and highlights Developer for a Starter link", async () => {
    mocks.offers = [
      offer("developer_monthly", "Builder", {
        funding_policy: "prepaid",
        topoff: {
          amount_cents: 300,
          threshold_cents: 200,
          default_enabled: true,
        },
      }),
      offer("pro_monthly", "Team"),
    ]
    render(<PlanPickerOptions preselected="starter" locator={locator} />)
    const builder = await screen.findByRole("form", { name: "Builder plan" })
    const action = new URL(builder.getAttribute("action")!, "https://x.test")
    expect(Object.fromEntries(action.searchParams)).toEqual({
      offer: "developer",
      ...locator,
    })
    expect(mocks.load).toHaveBeenCalledWith(locator)
    expect(builder).toHaveClass("border-brand/70")
    expect(builder.textContent).toMatch(/\$11 \/ month/)
    expect(builder.textContent).toMatch(
      /Auto Topoff adds \$3 when credit drops below \$2/,
    )
    expect(screen.getByRole("form", { name: "Team plan" })).not.toHaveClass(
      "border-brand/70",
    )
  })

  it("highlights a plan still on sale when the preselected one isn't", async () => {
    mocks.offers = [
      offer("developer_monthly", "Builder", { sellable: false }),
      offer("pro_monthly", "Team"),
    ]
    render(<PlanPickerOptions preselected="developer" locator={locator} />)
    expect(await screen.findByRole("form", { name: "Team plan" })).toHaveClass(
      "border-brand/70",
    )
    expect(screen.queryByRole("form", { name: "Builder plan" })).toBeNull()
  })

  it("falls back to today's plan buttons when offers can't be read", async () => {
    mocks.offers = null
    render(<PlanPickerOptions preselected={null} locator={locator} />)
    expect(
      await screen.findByRole("button", { name: "Developer" }),
    ).toBeTruthy()
    expect(screen.getByRole("button", { name: "Pro" })).toBeTruthy()
  })

  it("says so when no plan is sellable", async () => {
    mocks.offers = [offer("pro_monthly", "Team", { sellable: false })]
    render(<PlanPickerOptions preselected={null} locator={locator} />)
    expect(await screen.findByText(/No plans are available/)).toBeTruthy()
  })
})
