vi.mock("@/hooks/use-billing-capabilities", () => ({
  useBillingCapabilities: () => ({
    data: mocks.capabilityUnavailable
      ? undefined
      : {
          pricing_version: "v2",
          entry_open: true,
          fresh_entry: {
            starter: mocks.buyCredit,
            pro: mocks.buyCredit,
            auto_recharge: mocks.recharge,
            choose_free: true,
          },
        },
  }),
}))
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { TeamPlan } from "@/lib/api/billing-v2"

const mocks = vi.hoisted(() => ({
  capabilityUnavailable: false,
  buyCredit: true,
  recharge: true,
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
  mocks.capabilityUnavailable = false
  mocks.buyCredit = true
  mocks.recharge = true
  mocks.plan.mockReturnValue({ data: null })
  mocks.prepaid.mockReturnValue({ data: undefined })
  mocks.summary.mockReturnValue({
    data: { permissions: { can_view: true, can_manage: true } },
  })
})

describe("PlanBanner with pricing v2 off", () => {
  it("renders the legacy banner when there is no assigned plan", () => {
    mocks.version.mockReturnValue("legacy")
    mount()
    expect(screen.getByTestId("legacy-banner")).toBeTruthy()
    expect(mocks.plan).toHaveBeenCalledWith(true)
    expect(mocks.prepaid).not.toHaveBeenCalled()
    expect(mocks.returnNotice).toHaveBeenCalled()
  })
})

describe("PlanBanner with pricing v2 on", () => {
  beforeEach(() => mocks.version.mockReturnValue("v2"))

  it("hides retained permissions when the billing summary refresh fails", () => {
    mocks.plan.mockReturnValue({ data: plan("free") })
    mocks.summary.mockReturnValue({
      data: { permissions: { can_view: true, can_manage: true } },
      isError: true,
    })
    const { container } = mount()
    expect(container.textContent).toBe("")
    expect(screen.queryByRole("link", { name: "Upgrade" })).toBeNull()
  })

  it("keeps assigned Free cardless after the public switch is rolled back", () => {
    mocks.version.mockReturnValue("legacy")
    mocks.plan.mockReturnValue({ data: plan("free") })
    mount()
    expect(screen.getByRole("link", { name: "Upgrade" })).toBeTruthy()
    expect(screen.queryByTestId("legacy-banner")).toBeNull()
  })

  it("pitches an upgrade on Free using the plan's own limits", () => {
    mocks.plan.mockReturnValue({ data: plan("free") })
    mount()
    expect(screen.queryByTestId("legacy-banner")).toBeNull()
    expect(
      screen.getByRole("region", { name: "Free plan" }).textContent,
    ).toMatch(/run 1 sandbox at a time on Free/)
    expect(screen.getByRole("link", { name: "Upgrade" })).toBeTruthy()
    expect(mocks.returnNotice).toHaveBeenCalled()
  })

  it("keeps payment prompts hidden while the plan loads or fails", () => {
    mocks.plan.mockReturnValue({ data: undefined, isError: true })
    mount()
    expect(screen.queryByTestId("legacy-banner")).toBeNull()
  })

  it("says compute is paused at a zero balance even without the low flag", () => {
    mocks.plan.mockReturnValue({ data: plan("prepaid") })
    mocks.prepaid.mockReturnValue({
      data: {
        balance_cents: 0,
        auto_recharge: {
          enabled: false,
          threshold_cents: null,
          amount_cents: null,
          disabled_reason: null,
          disabled_at: null,
          in_flight: false,
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
        auto_recharge: {
          enabled: false,
          threshold_cents: null,
          amount_cents: null,
          disabled_reason: null,
          disabled_at: null,
          in_flight: false,
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
        auto_recharge: {
          enabled: true,
          threshold_cents: 500,
          amount_cents: 2000,
          disabled_reason: null,
          disabled_at: null,
          in_flight: false,
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
          auto_recharge: {
            enabled: false,
            threshold_cents: null,
            amount_cents: null,
            disabled_reason: null,
            disabled_at: null,
            in_flight: false,
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

  it("mentions a top-up in flight and offers to turn auto-recharge back on", () => {
    mocks.plan.mockReturnValue({ data: plan("prepaid") })
    mocks.prepaid.mockReturnValue({
      data: {
        balance_cents: 0,
        auto_recharge: {
          enabled: false,
          threshold_cents: 500,
          amount_cents: 2000,
          disabled_reason: "card_declined",
          disabled_at: "2026-10-22T00:00:00Z",
          in_flight: true,
        },
      },
    })
    mount()
    expect(screen.getByText(/while a top-up is being processed/)).toBeTruthy()
    expect(
      screen.getByRole("link", { name: "Turn auto-recharge back on" }),
    ).toBeTruthy()
  })

  it("stays quiet on a low balance when auto-recharge will top it up", () => {
    mocks.plan.mockReturnValue({ data: plan("prepaid") })
    mocks.prepaid.mockReturnValue({
      data: {
        balance_cents: 400,
        auto_recharge: {
          enabled: true,
          threshold_cents: 500,
          amount_cents: 2000,
          disabled_reason: null,
          disabled_at: null,
          in_flight: true,
        },
      },
    })
    const { container } = mount()
    expect(container.textContent).toBe("")
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

it("does not misreport an administrator's permissions when capabilities fail", () => {
  mocks.capabilityUnavailable = true
  mocks.plan.mockReturnValue({ data: plan("free") })
  mount()
  expect(
    screen.queryByText(/Contact your team's billing administrator/),
  ).toBeNull()
  expect(screen.queryByRole("link", { name: "Upgrade" })).toBeNull()
})
it.each([
  [false, true],
  [true, false],
])(
  "gates Starter purchase=%s and recharge=%s independently",
  (buy, recharge) => {
    mocks.buyCredit = buy
    mocks.recharge = recharge
    mocks.plan.mockReturnValue({ data: plan("prepaid") })
    mocks.prepaid.mockReturnValue({
      data: { balance_cents: 250, auto_recharge: { enabled: false } },
    })
    mount()
    expect(Boolean(screen.queryByRole("link", { name: "Buy credit" }))).toBe(
      buy,
    )
    expect(
      Boolean(screen.queryByRole("link", { name: "Set up auto-recharge" })),
    ).toBe(recharge)
    expect(
      screen.queryByText(/Contact your team's billing administrator/),
    ).toBeNull()
  },
)
