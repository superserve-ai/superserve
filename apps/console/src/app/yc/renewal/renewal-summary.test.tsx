import { render, screen } from "@testing-library/react"
import { expect, it } from "vitest"

import { RenewalSummary } from "./renewal-summary"

it.each(["monthly", "free"] as const)(
  "keeps confirmed annual separate from pending %s",
  (choice) => {
    render(
      <RenewalSummary
        renewal={{
          confirmed: {
            choice: "annual",
            terms: "$12,000 per year",
            boundary: "October 21, 2027",
          },
          requested: {
            choice,
            terms: "Approved successor terms",
            boundary: "October 21, 2027",
            state: "outcome_unknown",
          },
          options: [],
          successor: "payment_pending",
        }}
      />,
    )
    expect(
      screen.getByRole("heading", { name: "Confirmed: Pro Annual" }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/may renew while this request is pending/),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Paid benefits are not active yet/),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/does not clear existing usage/),
    ).toBeInTheDocument()
  },
)
