import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { BillingSummaryResponse } from "@/lib/api/billing"
import type { FreeAllowance, TeamPlan } from "@/lib/api/billing-v2"

const mocks = vi.hoisted(() => ({
  version: vi.fn(),
  plan: vi.fn(),
  allowance: vi.fn(),
  prepaid: vi.fn(),
}))
vi.mock("@/components/current-plan", () => ({
  CurrentPlan: () => <div data-testid="legacy-plan" />,
}))
vi.mock("@/hooks/use-pricing-version", () => ({
  usePricingVersion: mocks.version,
}))
vi.mock("@/hooks/use-billing-v2", () => ({
  useTeamPlan: mocks.plan,
  useFreeAllowance: mocks.allowance,
  usePrepaidBalance: mocks.prepaid,
}))

import { PlanOverviewSection } from "./plan-overview-section"

const summary = {
  permissions: { can_view: true, can_manage: true },
  current_charges_usd: 312.5,
  billing_period: {
    start: "2026-10-01T00:00:00Z",
    end: "2026-11-01T00:00:00Z",
  },
} as unknown as BillingSummaryResponse

function allowance(overrides: Partial<FreeAllowance>): FreeAllowance {
  return {
    applies: true,
    window_started_at: null,
    resets_at: null,
    allowance_cents: 13.32,
    used_cents: 0,
    remaining_cents: 13.32,
    paused: false,
    paused_reason: null,
    as_of: "2026-10-23T11:00:00Z",
    ...overrides,
  }
}

function plan(overrides: Partial<TeamPlan>): TeamPlan {
  return {
    key: "pro_monthly",
    kind: "subscription",
    name: "Pro",
    limits: {
      max_concurrent: 1000,
      max_vcpu: 8,
      max_memory_mib: 32768,
      max_disk_mib: 102400,
      max_templates: null,
    },
    fee_cents: 25000,
    included_cents: 25000,
    period_start: "2026-10-01T00:00:00Z",
    period_end: "2026-11-01T00:00:00Z",
    pending_change: null,
    ...overrides,
  }
}

beforeEach(() => {
  mocks.plan.mockReturnValue({ data: undefined, isError: false })
  mocks.allowance.mockReturnValue({ data: undefined })
  mocks.prepaid.mockReturnValue({ data: undefined })
})

describe("PlanOverviewSection with pricing v2 off", () => {
  it("renders today's plan card and requests no v2 data", () => {
    mocks.version.mockReturnValue("legacy")
    render(<PlanOverviewSection summary={summary} />)
    expect(screen.getByTestId("legacy-plan")).toBeTruthy()
    expect(mocks.plan).not.toHaveBeenCalled()
    expect(mocks.allowance).not.toHaveBeenCalled()
    expect(mocks.prepaid).not.toHaveBeenCalled()
  })
})

describe("PlanOverviewSection with pricing v2 on", () => {
  beforeEach(() => mocks.version.mockReturnValue("v2"))

  it("shows Pro usage against the included amount", () => {
    mocks.plan.mockReturnValue({ data: plan({}), isError: false })
    render(<PlanOverviewSection summary={summary} />)
    expect(screen.getByText("$250 / month")).toBeTruthy()
    expect(screen.getByText(/of \$250 used/)).toBeTruthy()
    expect(screen.getByText(/\$62\.50 beyond the included usage/)).toBeTruthy()
    expect(screen.getByText("8 vCPU, 32 GiB memory, 100 GiB disk")).toBeTruthy()
    expect(screen.getByRole("link", { name: "Change plan" })).toBeTruthy()
  })

  it("doesn't report usage from a different billing period", () => {
    mocks.plan.mockReturnValue({
      data: plan({ period_start: "2026-10-15T00:00:00Z" }),
      isError: false,
    })
    render(<PlanOverviewSection summary={summary} />)
    expect(screen.getByText("Usage couldn't be loaded.")).toBeTruthy()
  })

  it("keeps today's plan card while the plan is loading", () => {
    render(<PlanOverviewSection summary={summary} />)
    expect(screen.getByTestId("legacy-plan")).toBeTruthy()
  })

  it("links Enterprise teams to contact us", () => {
    mocks.plan.mockReturnValue({
      data: plan({ key: "acme", kind: "custom", name: "Enterprise" }),
      isError: false,
    })
    render(<PlanOverviewSection summary={summary} />)
    expect(screen.getByRole("link", { name: "Contact us" })).toBeTruthy()
    expect(screen.queryByRole("link", { name: "Change plan" })).toBeNull()
  })

  it("shows the Free allowance window and its reset time", () => {
    mocks.plan.mockReturnValue({
      data: plan({ key: "free", kind: "free", name: "Free", fee_cents: 0 }),
      isError: false,
    })
    mocks.allowance.mockReturnValue({
      data: allowance({
        window_started_at: "2026-10-23T08:00:00Z",
        resets_at: "2026-10-24T08:00:00Z",
        used_cents: 4.87,
        remaining_cents: 8.45,
      }),
    })
    render(<PlanOverviewSection summary={summary} />)
    expect(mocks.allowance).toHaveBeenCalledWith(true)
    expect(screen.getByText("63%")).toBeTruthy()
    expect(
      screen.getByText(/of this window left \(\$0\.08 of \$0\.13\)/),
    ).toBeTruthy()
    expect(screen.getByText(/resets Oct 24, 8:00 AM UTC/)).toBeTruthy()
    expect(screen.getByRole("link", { name: "Upgrade" })).toBeTruthy()
  })

  it("explains a paused Free allowance and a window that has not started", () => {
    mocks.plan.mockReturnValue({
      data: plan({ key: "free", kind: "free", name: "Free" }),
      isError: false,
    })
    mocks.allowance.mockReturnValue({
      data: allowance({
        window_started_at: "2026-10-23T08:00:00Z",
        resets_at: "2026-10-24T08:00:00Z",
        used_cents: 13.32,
        remaining_cents: 0,
        paused: true,
        paused_reason: "free_allowance_exhausted",
      }),
    })
    const { unmount } = render(<PlanOverviewSection summary={summary} />)
    expect(
      screen.getByText(
        /Running sandboxes are paused and can.t start until Oct 24/,
      ),
    ).toBeTruthy()
    unmount()
    mocks.allowance.mockReturnValue({
      data: allowance({ used_cents: 9, remaining_cents: 4.32 }),
    })
    render(<PlanOverviewSection summary={summary} />)
    expect(
      screen.getByText(/starts when you next start a sandbox/),
    ).toBeTruthy()
  })

  it("shows the Starter balance and auto-recharge settings", () => {
    mocks.plan.mockReturnValue({
      data: plan({
        key: "starter",
        kind: "prepaid",
        name: "Starter",
        fee_cents: null,
      }),
      isError: false,
    })
    mocks.prepaid.mockReturnValue({
      data: {
        balance_cents: 4250,
        low_balance: false,
        auto_recharge: {
          enabled: true,
          threshold_cents: 500,
          amount_cents: 2000,
        },
      },
    })
    render(<PlanOverviewSection summary={summary} />)
    expect(screen.getByText("$42.50")).toBeTruthy()
    expect(
      screen.getByText(/adds \$20 when the balance drops below \$5/),
    ).toBeTruthy()
  })

  it("doesn't show allowance figures that don't apply to the team", () => {
    mocks.plan.mockReturnValue({
      data: plan({ key: "free", kind: "free", name: "Free" }),
      isError: false,
    })
    mocks.allowance.mockReturnValue({
      data: {
        applies: false,
        window_started_at: null,
        resets_at: null,
        allowance_cents: null,
        used_cents: null,
        remaining_cents: null,
        paused: null,
        paused_reason: null,
        as_of: null,
      },
    })
    render(<PlanOverviewSection summary={summary} />)
    expect(screen.getByText("Allowance couldn't be loaded.")).toBeTruthy()
  })

  it("shows a scheduled downgrade", () => {
    mocks.plan.mockReturnValue({
      data: plan({
        pending_change: {
          plan_key: "free",
          plan_name: "Free",
          effective_at: "2026-11-01T00:00:00Z",
          undoable: true,
        },
      }),
      isError: false,
    })
    render(<PlanOverviewSection summary={summary} />)
    expect(screen.getByText("Change scheduled")).toBeTruthy()
    expect(screen.getByText("Changes to Free on Nov 1, 2026.")).toBeTruthy()
  })

  it("falls back to today's plan card for legacy teams and when the plan can't load", () => {
    mocks.plan.mockReturnValue({
      data: plan({ key: "legacy", kind: "legacy_payg", name: "Pay as you go" }),
      isError: false,
    })
    const { unmount } = render(<PlanOverviewSection summary={summary} />)
    expect(screen.getByTestId("legacy-plan")).toBeTruthy()
    unmount()
    mocks.plan.mockReturnValue({ data: undefined, isError: true })
    render(<PlanOverviewSection summary={summary} />)
    expect(screen.getByTestId("legacy-plan")).toBeTruthy()
  })

  it("hides plan changes from members who cannot manage billing", () => {
    mocks.plan.mockReturnValue({ data: plan({}), isError: false })
    render(
      <PlanOverviewSection
        summary={
          {
            ...summary,
            permissions: { can_view: true, can_manage: false },
          } as BillingSummaryResponse
        }
      />,
    )
    expect(screen.queryByRole("link", { name: "Change plan" })).toBeNull()
  })
})
