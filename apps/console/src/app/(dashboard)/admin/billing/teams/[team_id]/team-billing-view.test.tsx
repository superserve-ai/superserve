import { render, screen } from "@testing-library/react"
import { expect, it, vi } from "vitest"

import { TeamBillingView } from "./team-billing-view"

vi.mock("./actions", () => ({
  requestPlanChangeAction: vi.fn(),
  undoPlanChangeAction: vi.fn(),
  assignTeamPlanAction: vi.fn(),
  grantStaffCreditAction: vi.fn(),
}))

const team = "22222222-2222-4222-8222-222222222222"
const starter = {
  id: "55555555-5555-4555-8555-555555555555",
  plan_key: "starter",
  kind: "prepaid",
  terms: { display_name: "Starter" },
  limits: { max_concurrent: 100 },
  effective_from: "2026-11-05T14:20:00Z",
  effective_to: null,
  source: "credit_purchase",
  reason: "",
}
const custom = {
  id: "44444444-4444-4444-8444-444444444444",
  family: "enterprise_example",
  version: 1,
  state: "published",
  kind: "custom",
  display_name: "Enterprise",
  limits: {},
}

function renderView(pricingV2: boolean, canWrite = true) {
  render(
    <TeamBillingView
      plans={{
        current: pricingV2 ? starter : null,
        history: pricingV2 ? [starter] : [],
        pending_change: null,
      }}
      catalog={{ pricingV2, plans: [custom] }}
      staffCredits={[]}
      region="use"
      teamId={team}
      canWrite={canWrite}
    />,
  )
}

it("offers no plan writes while pricing v2 is off", () => {
  renderView(false)
  expect(screen.getByText(/No plan assigned/)).toBeTruthy()
  expect(screen.queryByLabelText(/Move to/)).toBeNull()
  expect(screen.queryByRole("button", { name: "Assign plan" })).toBeNull()
  expect(screen.getByRole("button", { name: /Grant credit/ })).toBeTruthy()
})

it("offers plan writes to billing writers under pricing v2", () => {
  renderView(true)
  expect(screen.getByLabelText(/Move to/)).toBeTruthy()
  expect(screen.getByRole("button", { name: "Assign plan" })).toBeTruthy()
})

it("shows billing readers the plan without write forms", () => {
  renderView(true, false)
  expect(screen.getAllByText("Starter").length).toBeGreaterThan(0)
  expect(screen.queryByLabelText(/Move to/)).toBeNull()
  expect(screen.queryByRole("button", { name: "Assign plan" })).toBeNull()
})
