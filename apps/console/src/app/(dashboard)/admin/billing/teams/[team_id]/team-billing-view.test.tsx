import { render, screen } from "@testing-library/react"
import { expect, it, vi } from "vitest"

import type { TeamPlanAssignments } from "@/lib/admin/team-billing"

import { TeamBillingView } from "./team-billing-view"

vi.mock("./actions", () => ({
  requestPlanChangeAction: vi.fn(),
  undoPlanChangeAction: vi.fn(),
  assignTeamPlanAction: vi.fn(),
  grantStaffCreditAction: vi.fn(),
}))

const team = "22222222-2222-4222-8222-222222222222"
const limits = {
  max_concurrent: 1000,
  max_vcpu: 8,
  max_memory_mib: 32768,
  max_disk_mib: 102400,
  max_templates: null,
}
const pro = {
  id: "55555555-5555-4555-8555-555555555555",
  plan_key: "pro_monthly",
  kind: "subscription",
  terms: { display_name: "Pro" },
  limits,
  effective_from: "2026-11-05T14:20:00Z",
  effective_to: null,
  source: "checkout",
  reason: "",
}
const pending = {
  id: "66666666-6666-4666-8666-666666666666",
  target_plan_key: "free",
  target_display_name: "Free",
  effective_at: "2026-12-05T14:20:00Z",
  undoable: true,
  pauses_running: true,
}
const enterprise = {
  id: "44444444-4444-4444-8444-444444444444",
  family: "enterprise_example",
  version: 1,
  state: "published",
  kind: "custom",
  display_name: "Enterprise",
  limits: { max_concurrent: 5000 },
}

function renderView({
  plans = { current: pro, history: [pro], pending_change: null },
  pricingV2 = true,
  canWrite = true,
}: {
  plans?: TeamPlanAssignments
  pricingV2?: boolean
  canWrite?: boolean
}) {
  render(
    <TeamBillingView
      plans={plans}
      catalog={{ pricingV2, assignablePlans: [enterprise], freeLimits: null }}
      staffCredits={[]}
      region="use"
      teamId={team}
      canWrite={canWrite}
    />,
  )
}

function expectNoPlanWrites() {
  expect(screen.queryByLabelText(/Move to/)).toBeNull()
  expect(screen.queryByLabelText(/Undo reason/)).toBeNull()
  expect(screen.queryByRole("button", { name: "Assign plan" })).toBeNull()
}

it("offers no plan writes while pricing v2 is off", () => {
  renderView({
    plans: { current: null, history: [], pending_change: null },
    pricingV2: false,
  })
  expect(screen.getByText(/No plan assigned/)).toBeTruthy()
  expectNoPlanWrites()
  expect(screen.getByRole("button", { name: /Grant credit/ })).toBeTruthy()
})

it("marks a leftover assignment inactive and offers no writes after switch-off", () => {
  renderView({
    plans: { current: pro, history: [pro], pending_change: pending },
    pricingV2: false,
  })
  expect(screen.getByText(/this plan is not in effect/)).toBeTruthy()
  expectNoPlanWrites()
})

it("offers the downgrades the plan change engine accepts for the plan's kind", () => {
  renderView({})
  const select = screen.getByLabelText(/Move to/)
  const options = [...select.querySelectorAll("option")]
    .map((o) => o.textContent)
    .slice(1)
  expect(options).toEqual(["Starter", "Free"])
  expect(screen.getByRole("button", { name: "Assign plan" })).toBeTruthy()
})

it("offers undo for an undoable pending change", () => {
  renderView({
    plans: { current: pro, history: [pro], pending_change: pending },
  })
  expect(screen.getByLabelText(/Undo reason/)).toBeTruthy()
  expect(screen.queryByLabelText(/Move to/)).toBeNull()
})

it("does not claim nothing is pending when the backend omits it", () => {
  renderView({ plans: { current: pro, history: [pro] } })
  expect(screen.getByText(/Pending change status is unavailable/)).toBeTruthy()
  expect(screen.queryByLabelText(/Move to/)).toBeNull()
})

it("shows billing readers the plan without write forms", () => {
  renderView({ canWrite: false })
  expect(screen.getAllByText("Pro").length).toBeGreaterThan(0)
  expectNoPlanWrites()
})
