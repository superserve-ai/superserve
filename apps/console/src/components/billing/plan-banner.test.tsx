vi.mock("@/hooks/use-billing-capabilities", () => ({
  useBillingCapabilities: () => ({
    data: mocks.capabilityUnavailable
      ? undefined
      : {
          pricing_version: "v2",
          entry_open: true,
          fresh_entry: {
            starter: mocks.buyCredit,
            pro: mocks.pro ?? mocks.buyCredit,
            auto_recharge: mocks.recharge,
            choose_free: true,
          },
          offers: mocks.offers,
          catalog: { pricing_version: "v2", cards: mocks.cards },
        },
  }),
}))
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { TeamPlan } from "@/lib/api/billing-v2"

const mocks = vi.hoisted(() => ({
  capabilityUnavailable: false,
  offers: undefined as unknown[] | undefined,
  cards: [] as unknown[],
  buyCredit: true,
  pro: undefined as boolean | undefined,
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
    name: kind === "prepaid" ? "Starter" : kind,
    limits,
    fee_cents: null,
    included_cents: null,
    period_start: null,
    period_end: null,
    effective_from: "2026-10-01T00:00:00Z",
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
  mocks.offers = undefined
  mocks.cards = []
  mocks.buyCredit = true
  mocks.pro = undefined
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
        low_balance: true,
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

  const card = (family: string, name: string, available = true) => ({
    family,
    kind: "subscription",
    name,
    monthly: { offer_key: `${family}_monthly`, available },
  })

  it("lets a Free team choose between the plans it can buy", () => {
    mocks.cards = [card("developer", "Builder"), card("pro", "Team")]
    mocks.plan.mockReturnValue({ data: plan("free") })
    mount()
    expect(
      screen.getByRole("region", { name: "Free plan" }).textContent,
    ).toMatch(/Upgrade to Builder or Team/)
    expect(
      screen.getByRole("link", { name: "Get Builder" }).getAttribute("href"),
    ).toMatch(/\/billing\/pro\/?\?plan=developer$/)
    expect(
      screen.getByRole("link", { name: "Get Team" }).getAttribute("href"),
    ).toMatch(/\/billing\/pro\/?$/)
  })

  it("falls back to the upgrade page when no plan passes the purchase check", () => {
    mocks.cards = [card("developer", "Builder", false)]
    mocks.plan.mockReturnValue({ data: plan("free") })
    mount()
    expect(screen.queryByRole("link", { name: /^Get / })).toBeNull()
    expect(screen.getByRole("link", { name: "Upgrade" })).toBeTruthy()
  })

  it("names no plans when the team can't upgrade now", () => {
    mocks.buyCredit = false
    mocks.cards = [card("developer", "Builder"), card("pro", "Team")]
    mocks.plan.mockReturnValue({ data: plan("free") })
    mount()
    expect(
      screen.getByRole("region", { name: "Free plan" }).textContent,
    ).not.toMatch(/Upgrade to Builder/)
    expect(screen.queryByRole("link")).toBeNull()
  })

  it("doesn't let Starter entry alone put an upgrade on a Free team's banner", () => {
    mocks.pro = false
    mocks.plan.mockReturnValue({ data: plan("free") })
    mount()
    expect(screen.queryByRole("link")).toBeNull()
    expect(screen.queryByText(/Buy credit|Add more|Starter/)).toBeNull()
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
      data: {
        balance_cents: 250,
        low_balance: true,
        auto_recharge: { enabled: false },
      },
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

describe("PlanBanner for a credit-funded subscription", () => {
  const funded = {
    ...plan("subscription"),
    key: "funded_monthly",
    name: "Funded",
  }
  const offer = {
    offer_key: "funded_monthly",
    family: "funded",
    display_name: "Funded",
    price_cents: 700,
    interval_months: 1,
    included_credit_cents: 700,
    funding_policy: "prepaid",
    topoff: { amount_cents: 300, threshold_cents: 200, default_enabled: true },
    sellable: true,
  }
  const balance = (
    cents: number,
    {
      low = false,
      enabled = false,
      observed = true,
      disabled_reason = null as string | null,
    } = {},
  ) => ({
    data: {
      balance_cents: cents,
      balance_observed: observed,
      low_balance: low,
      auto_recharge: {
        enabled,
        threshold_cents: enabled ? 200 : null,
        amount_cents: enabled ? 300 : null,
        disabled_reason,
        disabled_at: null,
        in_flight: false,
      },
    },
  })
  const fundingState = (state: string) =>
    mocks.summary.mockReturnValue({
      data: {
        permissions: { can_view: true, can_manage: true },
        trial: { state },
      },
    })

  beforeEach(() => {
    mocks.offers = [offer]
    mocks.plan.mockReturnValue({ data: funded })
    fundingState("active")
  })

  it("warns when the backend reports low credit with Auto Reload off", () => {
    mocks.prepaid.mockReturnValue(balance(150, { low: true }))
    mount()
    const banner = screen.getByRole("region", { name: "Credit balance" })
    expect(banner.textContent).toMatch(
      /^Your credit balance is too low\. Buy usage to continue running sandboxes\./,
    )
    expect(banner.textContent).not.toMatch(/\$/)
    expect(
      screen.getByRole("link", { name: "Turn on Auto Reload" }),
    ).toHaveAttribute("href", expect.stringMatching(/#auto-topoff$/))
  })

  it("keeps the warning but drops the Auto Reload link while entry is closed", () => {
    mocks.recharge = false
    mocks.prepaid.mockReturnValue(balance(150, { low: true }))
    mount()
    expect(
      screen.getByRole("region", { name: "Credit balance" }).textContent,
    ).toMatch(/^Your credit balance is too low\./)
    expect(
      screen.queryByRole("link", { name: /Auto Reload/ }),
    ).not.toBeInTheDocument()
  })

  it("follows the backend's flag rather than its own threshold", () => {
    mocks.prepaid.mockReturnValue(balance(150, { low: false }))
    expect(mount().container.textContent).toBe("")
  })

  it("stays quiet while Auto Reload is on", () => {
    fundingState("auto_topoff")
    mocks.prepaid.mockReturnValue(balance(0, { low: true, enabled: true }))
    expect(mount().container.textContent).toBe("")
  })

  it("warns after a failed charge turned Auto Reload off", () => {
    mocks.prepaid.mockReturnValue(
      balance(0, { low: true, disabled_reason: "card_declined" }),
    )
    mount()
    expect(screen.getByText(/credit balance is too low/)).toBeTruthy()
    expect(
      screen.getByRole("link", { name: "Turn Auto Reload back on" }),
    ).toBeTruthy()
  })

  it("says nothing on an empty balance the backend doesn't call low", () => {
    mocks.prepaid.mockReturnValue(balance(0, { low: false }))
    expect(mount().container.textContent).toBe("")
  })

  it("says nothing while a just-settled checkout's credit isn't observed", () => {
    fundingState("unknown")
    mocks.prepaid.mockReturnValue(balance(0, { observed: false }))
    expect(mount().container.textContent).toBe("")
  })

  it("says nothing during renewal grace before the new grant is observed", () => {
    fundingState("unknown")
    mocks.prepaid.mockReturnValue(balance(0))
    expect(mount().container.textContent).toBe("")
  })

  it("reads the funding policy from the team's frozen terms first", () => {
    mocks.offers = []
    mocks.plan.mockReturnValue({
      data: { ...funded, funding_policy: "prepaid" },
    })
    mocks.prepaid.mockReturnValue(balance(250, { low: true }))
    const { unmount } = mount()
    expect(screen.getByRole("region", { name: "Credit balance" })).toBeTruthy()
    unmount()

    mocks.offers = [offer]
    mocks.plan.mockReturnValue({
      data: { ...funded, funding_policy: "postpaid" },
    })
    expect(mount().container.textContent).toBe("")
  })

  it("treats a subscription missing from the offers as postpaid", () => {
    mocks.offers = []
    mocks.prepaid.mockReturnValue(balance(0, { low: true }))
    expect(mount().container.textContent).toBe("")
  })
})

it("stays quiet on an empty balance the backend doesn't call low while the summary still reads active", () => {
  mocks.plan.mockReturnValue({
    data: {
      ...plan("subscription"),
      key: "developer_monthly",
      name: "Developer",
      funding_policy: "prepaid",
      topoff: {
        amount_cents: 2500,
        threshold_cents: 1000,
        default_enabled: false,
      },
    },
  })
  mocks.summary.mockReturnValue({
    data: {
      permissions: { can_view: true, can_manage: true },
      trial: {
        state: "active",
        remaining_usd: 1,
        low_credit_threshold_usd: 10,
      },
    },
  })
  mocks.prepaid.mockReturnValue({
    data: {
      balance_cents: 0,
      balance_observed: true,
      low_balance: false,
      auto_recharge: {
        enabled: false,
        threshold_cents: 1000,
        amount_cents: 2500,
        disabled_reason: null,
        disabled_at: null,
        in_flight: false,
      },
    },
  })
  expect(mount().container.textContent).toBe("")
})

it("stays quiet while the funded credit state is unknown", () => {
  mocks.plan.mockReturnValue({
    data: {
      ...plan("subscription"),
      key: "developer_monthly",
      name: "Developer",
      funding_policy: "prepaid",
      topoff: {
        amount_cents: 2500,
        threshold_cents: 1000,
        default_enabled: false,
      },
    },
  })
  mocks.summary.mockReturnValue({
    data: {
      permissions: { can_view: true, can_manage: true },
      trial: {
        state: "unknown",
        remaining_usd: 0,
        eligible: false,
        low_credit_threshold_usd: 10,
      },
    },
  })
  mocks.prepaid.mockReturnValue({
    data: {
      balance_cents: 0,
      balance_observed: true,
      low_balance: false,
      auto_recharge: {
        enabled: false,
        threshold_cents: 1000,
        amount_cents: 2500,
        disabled_reason: null,
        disabled_at: null,
        in_flight: false,
      },
    },
  })
  expect(mount().container.textContent).toBe("")
})
