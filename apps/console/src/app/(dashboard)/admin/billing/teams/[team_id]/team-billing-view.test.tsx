import { render, screen } from "@testing-library/react"
import { expect, it, vi } from "vitest"

import type {
  PlanCatalog,
  StaffCredit,
  TeamPlanAssignments,
} from "@/lib/admin/team-billing"

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
  catalog = { pricingV2, assignablePlans: [enterprise], freeLimits: null },
  canWrite = true,
  staffCredits = [],
}: {
  plans?: TeamPlanAssignments | null
  staffCredits?: StaffCredit[] | null
  pricingV2?: boolean
  catalog?: PlanCatalog | null
  canWrite?: boolean
}) {
  render(
    <TeamBillingView
      plans={plans}
      catalog={catalog}
      staffCredits={staffCredits}
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
  expect(screen.getByText("No plan history yet.")).toBeTruthy()
  expect(screen.queryByText("Plan history is unavailable.")).toBeNull()
  expectNoPlanWrites()
  expect(screen.getByRole("button", { name: /Grant credit/ })).toBeTruthy()
})

it("keeps an existing assignment and undo available after switch-off", () => {
  renderView({
    plans: { current: pro, history: [pro], pending_change: pending },
    pricingV2: false,
  })
  expect(screen.getByText(/Existing plans remain in effect/)).toBeTruthy()
  expect(screen.getByLabelText(/Undo reason/)).toBeTruthy()
  expect(screen.queryByRole("button", { name: "Assign plan" })).toBeNull()
})

it.each([true, false])(
  "offers accepted downgrades with pricing v2 on=%s",
  (pricingV2) => {
    renderView({ pricingV2 })
    const select = screen.getByLabelText(/Move to/)
    const options = [...select.querySelectorAll("option")]
      .map((o) => o.textContent)
      .slice(1)
    expect(options).toEqual(["Starter", "Free"])
    expect(Boolean(screen.queryByRole("button", { name: "Assign plan" }))).toBe(
      pricingV2,
    )
  },
)

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

it("hides plan assignment when the current plan read fails", () => {
  renderView({ plans: null })
  expect(screen.getByText(/The team's plan is unavailable/)).toBeTruthy()
  expect(screen.getByText("Plan history is unavailable.")).toBeTruthy()
  expect(screen.queryByText("No plan history yet.")).toBeNull()
  expectNoPlanWrites()
  expect(screen.getByRole("button", { name: /Grant credit/ })).toBeTruthy()
})

it("hides new credit when its history read fails", () => {
  renderView({ staffCredits: null })
  expect(screen.getByText(/Staff credit history is unavailable/)).toBeTruthy()
  expect(screen.queryByLabelText(/Credit amount/)).toBeNull()
  expect(screen.queryByRole("button", { name: /Grant credit/ })).toBeNull()
  expect(screen.getByRole("button", { name: "Assign plan" })).toBeTruthy()
})

it("reports unknown pricing status after a catalog failure without blocking exits", () => {
  renderView({ catalog: null })
  expect(screen.getByText("Pricing status unavailable")).toBeTruthy()
  expect(screen.queryByText(/New entry into pricing v2 is off/)).toBeNull()
  expect(screen.queryByText("Legacy pricing")).toBeNull()
  expect(screen.queryByRole("button", { name: "Assign plan" })).toBeNull()
  expect(screen.getByLabelText(/Move to/)).toBeTruthy()
})
