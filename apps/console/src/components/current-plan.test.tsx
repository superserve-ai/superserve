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
  ["payment_failed", "Payment didn’t go through · choose a plan to try again"],
])("never calls a %s team pay as you go", (status, label) => {
  render(<CurrentPlan summary={summary(status)} />)
  expect(screen.getByText("Free trial")).toBeTruthy()
  expect(screen.getByText(label)).toBeTruthy()
  expect(screen.queryByText(/Pay as you go/)).toBeNull()
})

it("shows neutral plan copy for a migrated team", () => {
  render(<CurrentPlan summary={summary("trial_ended")} legacyTransition />)
  expect(screen.getByText("No plan")).toBeInTheDocument()
  expect(screen.getByText("Choose a plan to continue")).toBeInTheDocument()
  expect(screen.queryByText(/Trial ended|Free trial/i)).toBeNull()
})

it("keeps payment failure copy for a migrated team with no plan", () => {
  render(<CurrentPlan summary={summary("payment_failed")} legacyTransition />)
  expect(screen.getByText("No plan")).toBeInTheDocument()
  expect(
    screen.getByText("Payment didn’t go through · choose a plan to try again"),
  ).toBeInTheDocument()
  expect(screen.queryByText("Free trial")).toBeNull()
})

it("tells a team that needs a plan it never had a trial", () => {
  const plan = summary("plan_required")
  plan.plan!.name = "No plan"
  render(<CurrentPlan summary={plan} />)
  expect(
    screen.getByText("Free covers your first team · choose a plan"),
  ).toBeTruthy()
  expect(screen.queryByText(/Trial/)).toBeNull()
})
