import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { TeamPlan } from "@/lib/api/billing-v2"

const mocks = vi.hoisted(() => ({
  version: vi.fn(),
  plan: vi.fn(),
  prepaid: vi.fn(),
  summary: vi.fn(),
  returnNotice: vi.fn(),
}))
vi.mock("@/components/trial-billing-banner", () => ({
  TrialBillingBanner: () => <div data-testid="legacy-banner" />,
}))
vi.mock("@/hooks/use-pricing-version", () => ({
  usePricingVersion: mocks.version,
}))
vi.mock("@/hooks/use-billing-v2", () => ({
  useTeamPlan: mocks.plan,
  usePrepaidBalance: mocks.prepaid,
}))
vi.mock("@/hooks/use-billing-summary", () => ({
  useBillingSummary: mocks.summary,
}))
vi.mock("@/hooks/use-billing-return-notice", () => ({
  useBillingReturnNotice: mocks.returnNotice,
}))

import { PlanBanner } from "./plan-banner"

const limits = {
  max_concurrent: 1,
  max_vcpu: 1,
  max_memory_mib: 1024,
  max_disk_mib: 4096,
  max_templates: null,
}
function plan(kind: TeamPlan["kind"]): TeamPlan {
  return {
    key: kind,
    kind,
    name: kind,
    limits,
    fee_cents: null,
    included_cents: null,
    period_start: null,
    period_end: null,
    pending_change: null,
  }
}
function mount() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <PlanBanner />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mocks.plan.mockReturnValue({ data: undefined })
  mocks.prepaid.mockReturnValue({ data: undefined })
  mocks.summary.mockReturnValue({
    data: { permissions: { can_view: true, can_manage: true } },
  })
})

describe("PlanBanner with pricing v2 off", () => {
  it("renders only today's trial banner and never asks for v2 data", () => {
    mocks.version.mockReturnValue("legacy")
    mount()
    expect(screen.getByTestId("legacy-banner")).toBeTruthy()
    expect(mocks.plan).toHaveBeenCalledWith(false)
    expect(mocks.plan).not.toHaveBeenCalledWith(true)
    expect(mocks.prepaid).not.toHaveBeenCalled()
    expect(mocks.returnNotice).not.toHaveBeenCalled()
  })
})

describe("PlanBanner with pricing v2 on", () => {
  beforeEach(() => mocks.version.mockReturnValue("v2"))

  it("pitches an upgrade on Free using the plan's own limits", () => {
    mocks.plan.mockReturnValue({ data: plan("free") })
    mount()
    expect(screen.queryByTestId("legacy-banner")).toBeNull()
    expect(
      screen.getByRole("region", { name: "Free plan" }).textContent,
    ).toMatch(
      /1 sandbox running at a time, up to 1 vCPU, 1 GiB memory, 4 GiB disk each/,
    )
    expect(screen.getByRole("link", { name: "Upgrade" })).toBeTruthy()
    expect(mocks.returnNotice).toHaveBeenCalled()
  })

  it("keeps today's banner while the plan loads or if it fails", () => {
    mocks.plan.mockReturnValue({ data: undefined, isError: true })
    mount()
    expect(screen.getByTestId("legacy-banner")).toBeTruthy()
  })

  it("says compute is paused at a zero balance even without the low flag", () => {
    mocks.plan.mockReturnValue({ data: plan("prepaid") })
    mocks.prepaid.mockReturnValue({
      data: {
        balance_cents: 0,
        low_balance: false,
        auto_recharge: {
          enabled: false,
          threshold_cents: null,
          amount_cents: null,
        },
      },
    })
    mount()
    expect(screen.getByText(/has run out/)).toBeTruthy()
  })

  it("keeps today's banner for teams staying on legacy pay as you go", () => {
    mocks.plan.mockReturnValue({ data: plan("legacy_payg") })
    mount()
    expect(screen.getByTestId("legacy-banner")).toBeTruthy()
  })

  it("warns on a low Starter balance and offers auto-recharge", () => {
    mocks.plan.mockReturnValue({ data: plan("prepaid") })
    mocks.prepaid.mockReturnValue({
      data: {
        balance_cents: 250,
        low_balance: true,
        auto_recharge: {
          enabled: false,
          threshold_cents: null,
          amount_cents: null,
        },
      },
    })
    mount()
    expect(
      screen.getByRole("region", { name: "Starter balance" }).textContent,
    ).toMatch(/Your Starter balance is \$2\.50/)
    expect(
      screen.getByRole("link", { name: "Set up auto-recharge" }),
    ).toBeTruthy()
  })

  it("says compute is paused when the Starter balance is empty", () => {
    mocks.plan.mockReturnValue({ data: plan("prepaid") })
    mocks.prepaid.mockReturnValue({
      data: {
        balance_cents: 0,
        low_balance: true,
        auto_recharge: {
          enabled: true,
          threshold_cents: 500,
          amount_cents: 2000,
        },
      },
    })
    mount()
    expect(screen.getByText(/has run out/)).toBeTruthy()
    expect(
      screen.queryByRole("link", { name: "Set up auto-recharge" }),
    ).toBeNull()
  })

  it("shows nothing for a healthy Starter balance, Pro or Enterprise", () => {
    for (const [kind, prepaid] of [
      [
        "prepaid",
        {
          balance_cents: 9000,
          low_balance: false,
          auto_recharge: {
            enabled: false,
            threshold_cents: null,
            amount_cents: null,
          },
        },
      ],
      ["subscription", undefined],
      ["custom", undefined],
    ] as const) {
      mocks.plan.mockReturnValue({ data: plan(kind) })
      mocks.prepaid.mockReturnValue({ data: prepaid })
      const { container, unmount } = mount()
      expect(container.textContent).toBe("")
      unmount()
    }
  })

  it("hides actions from members who cannot manage billing", () => {
    mocks.plan.mockReturnValue({ data: plan("free") })
    mocks.summary.mockReturnValue({
      data: { permissions: { can_view: true, can_manage: false } },
    })
    mount()
    expect(screen.queryByRole("link", { name: "Upgrade" })).toBeNull()
    expect(screen.getByText(/billing administrator/)).toBeTruthy()
  })
})
