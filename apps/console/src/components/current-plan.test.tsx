import { render, screen } from "@testing-library/react"
import { expect, it } from "vitest"

import type { BillingSummaryResponse } from "@/lib/api/billing"

import { CurrentPlan } from "./current-plan"

const summary = (status: string) =>
  ({
    plan: {
      key: "trial",
      name: "Free trial",
      status,
      price_usd: null,
      billing_interval_months: null,
      starts_at: null,
      ends_at: null,
      included_usage: null,
    },
    pricing_tier: {
      plan_key: "trial",
      plan_name: "Free trial",
      currency: "USD",
    },
    credits_applied_usd: 0,
    credits_remaining_usd: 0.03,
  }) as unknown as BillingSummaryResponse

it.each([
  ["trial", "Trial credit · no card needed"],
  ["trial_ended", "Trial ended · choose a plan to continue"],
])("never calls a %s team pay as you go", (status, label) => {
  render(<CurrentPlan summary={summary(status)} />)
  expect(screen.getByText("Free trial")).toBeTruthy()
  expect(screen.getByText(label)).toBeTruthy()
  expect(screen.queryByText(/Pay as you go/)).toBeNull()
})
