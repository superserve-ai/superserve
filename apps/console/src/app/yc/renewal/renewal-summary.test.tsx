import { render, screen } from "@testing-library/react"
import { expect, it } from "vitest"

import { renewalSchema, renewalView } from "@/lib/yc/renewal-schema"
import { renewal } from "@/lib/yc/test-fixtures"

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

it.each(["active", "free", "payment_pending"] as const)(
  "renders confirmed instructions with the actual %s successor contract",
  (successor_state) => {
    const initial = renewal()
    const confirmed =
      successor_state === "free"
        ? { ...initial.last_confirmed!, choice: "free" as const, terms: null }
        : initial.last_confirmed!
    const parsed = renewalSchema.parse({
      ...initial,
      requested: confirmed,
      last_confirmed: confirmed,
      successor_state,
    })
    render(<RenewalSummary renewal={renewalView(parsed)} />)
    expect(
      screen.queryByText(/Your change is not confirmed/),
    ).not.toBeInTheDocument()
    expect(
      screen.getByText(
        successor_state === "active"
          ? "Your paid renewal plan is active."
          : successor_state === "free"
            ? "Your Free plan is now in effect."
            : /Paid benefits are not active yet/,
      ),
    ).toBeInTheDocument()
  },
)
