import { render, screen } from "@testing-library/react"
import { expect, it } from "vitest"

import { OfferTerms } from "./offer-terms"

it("shows the supplied fee, waiver, monthly expiry, overage and renewal terms before acceptance", () => {
  render(
    <OfferTerms
      terms={{
        title: "Approved YC offer",
        currency: "USD",
        annualFeeCents: 1200000,
        firstFeeWaived: true,
        termMonths: 12,
        allowances: [
          { firstMonth: 1, lastMonth: 3, monthlyCents: 3000000 },
          { firstMonth: 4, lastMonth: 12, monthlyCents: 100000 },
        ],
        expiration: "Credits expire each month without rollover.",
        overage:
          "No card is required while eligible credits remain. Overage requires payment.",
        renewal:
          "Renews to the approved Annual plan unless a different choice is confirmed. A pending change leaves the last confirmed instruction in place.",
        rates: [{ resource: "CPU", price: "$0.01 per core-hour" }],
      }}
    />,
  )
  expect(screen.getByText(/Annual fee/)).toHaveTextContent(
    "$12,000. Your first annual fee is fully waived.",
  )
  expect(screen.getByText("$30,000")).toBeInTheDocument()
  expect(screen.getByText("$1,000")).toBeInTheDocument()
  expect(screen.getByText(/without rollover/)).toBeInTheDocument()
  expect(screen.getByText(/No card is required/)).toBeInTheDocument()
  expect(screen.getByText(/pending change/)).toBeInTheDocument()
  expect(screen.queryByRole("button")).not.toBeInTheDocument()
})
