vi.mock("@/hooks/use-billing-capabilities", () => ({
  useBillingCapabilities: () => ({
    data: mocks.capabilitiesUnavailable
      ? undefined
      : {
          pricing_version: "v2",
          entry_open: true,
          fresh_entry: {
            starter: true,
            pro: true,
            auto_recharge: true,
            choose_free: true,
          },
          offers: mocks.offers,
        },
  }),
}))
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { BillingSummaryResponse } from "@/lib/api/billing"
import type { FreeAllowance, TeamPlan } from "@/lib/api/billing-v2"

const mocks = vi.hoisted(() => ({
  capabilitiesUnavailable: false,
  offers: undefined as unknown[] | undefined,
  version: vi.fn(),
  plan: vi.fn(),
  allowance: vi.fn(),
  prepaid: vi.fn(),
  pricing: vi.fn(),
}))
vi.mock("@/hooks/use-prepaid-credit", () => ({
  usePrepaidCredit: () => ({
    data: {
      checkout_idempotency_supported: true,
      balance_cents: 900,
      has_saved_card: true,
      purchases: [],
      auto_recharge: {
        enabled: false,
        threshold_cents: null,
        amount_cents: null,
        disabled_reason: null,
        disabled_at: null,
        in_flight: false,
      },
    },
  }),
}))
vi.mock("@/hooks/use-billing-context", () => ({
  useBillingContext: () => ({
    teamKey: "use:t",
    cacheScope: "self",
    ready: true,
  }),
}))
vi.mock("@superserve/ui", async (original) => ({
  ...(await original<typeof import("@superserve/ui")>()),
  useToast: () => ({ addToast: vi.fn() }),
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
  useAllowancePricing: mocks.pricing,
  usePrepaidBalance: mocks.prepaid,
}))

import { PlanOverviewSection } from "./plan-overview-section"

const summary = {
  permissions: { can_view: true, can_manage: true },
  current_charges_usd: 312.5,
  plan: {
    key: "pro_monthly",
    billing_interval_months: 1,
    price_usd: 250,
    included_usage: {
      amount_usd: 250,
      status: "issued",
      period_start: "2026-10-01T00:00:00Z",
      period_end: "2026-11-01T00:00:00Z",
    },
  },
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
    effective_from: "2026-10-01T00:00:00Z",
    pending_change: null,
    ...overrides,
  }
}

beforeEach(() => {
  mocks.capabilitiesUnavailable = false
  mocks.offers = undefined
  mocks.plan.mockReturnValue({ data: null, isError: false })
  mocks.allowance.mockReturnValue({ data: undefined })
  mocks.prepaid.mockReturnValue({ data: undefined })
  mocks.pricing.mockReturnValue({
    data: {
      plan_key: "free",
      currency: "USD",
      rates: [
        {
          resource_key: "vcpu",
          display_unit: "vCPU-hour",
          price_usd_hourly: 0.06,
        },
        {
          resource_key: "memory_gib",
          display_unit: "GiB-hour",
          price_usd_hourly: 0.0066,
        },
      ],
    },
  })
})

describe("PlanOverviewSection with pricing v2 off", () => {
  it("keeps an assigned team's settings change-plan link available after rollback", () => {
    mocks.version.mockReturnValue("legacy")
    mocks.plan.mockReturnValue({ data: plan({}), isError: false })
    render(<PlanOverviewSection summary={summary} details />)
    expect(screen.getByRole("link", { name: "Change plan" })).toBeTruthy()
  })

  it("renders today's plan card when there is no assigned plan", () => {
    mocks.version.mockReturnValue("legacy")
    render(<PlanOverviewSection summary={summary} />)
    expect(screen.getByTestId("legacy-plan")).toBeTruthy()
    expect(mocks.plan).toHaveBeenCalledWith(true)
    expect(mocks.allowance).toHaveBeenCalledWith(false)
    expect(mocks.prepaid).toHaveBeenCalledWith(false)
  })
})

describe("PlanOverviewSection with pricing v2 on", () => {
  beforeEach(() => mocks.version.mockReturnValue("v2"))

  it("doesn't label an annual subscription as monthly", () => {
    mocks.plan.mockReturnValue({
      data: plan({ key: "pro_annual" }),
      isError: false,
    })
    render(
      <PlanOverviewSection
        details
        summary={{
          ...summary,
          plan: {
            ...summary.plan!,
            key: "pro_annual",
            billing_interval_months: 12,
            price_usd: 3000,
          },
        }}
      />,
    )
    expect(screen.getByText("Subscription")).toBeTruthy()
    expect(screen.queryByText(/Monthly subscription|\$250 \/ month/)).toBeNull()
  })

  it.each([
    ["pending", "Included usage is being added."],
    ["not_issued", "Included usage is added once payment is confirmed."],
  ] as const)(
    "doesn't present %s included usage as active",
    (status, message) => {
      mocks.plan.mockReturnValue({ data: plan({}), isError: false })
      render(
        <PlanOverviewSection
          summary={{
            ...summary,
            plan: {
              ...summary.plan!,
              included_usage: { ...summary.plan!.included_usage!, status },
            },
          }}
        />,
      )
      expect(screen.getByText(message)).toBeTruthy()
      expect(
        screen.queryByText(/of \$250 used|beyond the included usage/),
      ).toBeNull()
    },
  )

  it("shows Pro usage against the included amount", () => {
    mocks.plan.mockReturnValue({ data: plan({}), isError: false })
    render(<PlanOverviewSection summary={summary} />)
    expect(screen.getByText(/of \$250 used/)).toBeTruthy()
    expect(screen.getByText(/\$62\.50 beyond the included usage/)).toBeTruthy()
    expect(screen.queryByText("Current plan")).toBeNull()
    expect(screen.queryByRole("link", { name: "Change plan" })).toBeNull()
  })

  it("describes a credit-funded subscription as paused when out, not billed later", () => {
    mocks.plan.mockReturnValue({
      data: plan({
        funding_policy: "prepaid",
        topoff: {
          amount_cents: 300,
          threshold_cents: 200,
          default_enabled: true,
        },
      }),
      isError: false,
    })
    mocks.prepaid.mockReturnValue({
      data: {
        balance_cents: 900,
        balance_observed: true,
        low_balance: false,
        auto_recharge: {
          enabled: true,
          threshold_cents: 200,
          amount_cents: 300,
          disabled_reason: null,
          disabled_at: null,
          in_flight: false,
        },
      },
    })
    render(<PlanOverviewSection summary={summary} />)
    expect(mocks.prepaid).toHaveBeenCalledWith(true)
    expect(screen.getByText(/of \$250 used/)).toBeTruthy()
    expect(screen.queryByText(/billed at usage rates/)).toBeNull()
    expect(screen.queryByText(/end of the period/)).toBeNull()
    expect(
      screen.getByText(
        /paid from Auto Topoff credit\. Running sandboxes pause/,
      ),
    ).toBeTruthy()
    expect(
      screen.getByText(
        /Auto Topoff is on: adds \$3 when credit drops below \$2/,
      ),
    ).toBeTruthy()
    expect(
      screen.getByRole("link", { name: "Manage Auto Topoff" }),
    ).toBeTruthy()
  })

  it("doesn't report usage from a different billing period", () => {
    mocks.plan.mockReturnValue({
      data: plan({ period_start: "2026-10-15T00:00:00Z" }),
      isError: false,
    })
    render(<PlanOverviewSection summary={summary} />)
    expect(screen.getByText("Usage couldn't be loaded.")).toBeTruthy()
  })

  it("doesn't substitute monetary terms from another plan", () => {
    mocks.plan.mockReturnValue({
      data: plan({ key: "frozen-plan" }),
      isError: false,
    })
    render(<PlanOverviewSection summary={summary} />)
    expect(screen.getByText("Usage couldn't be loaded.")).toBeTruthy()
    expect(screen.queryByText(/of \$250 used/)).toBeNull()
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
    expect(
      screen.getByRole("link", { name: "Contact us" }).getAttribute("href"),
    ).toBe("https://calendly.com/superserve-ai/25-min")
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
    expect(screen.getByText(/1 hour 16 minutes/)).toBeTruthy()
    expect(screen.getByText(/resets Oct 24, 8:00 AM UTC/)).toBeTruthy()
    expect(screen.getByRole("link", { name: "Upgrade" })).toBeTruthy()
  })

  it("doesn't invent runtime or remaining credit when the backend reading is incomplete", () => {
    mocks.plan.mockReturnValue({
      data: plan({ key: "free", kind: "free", name: "Free" }),
    })
    mocks.allowance.mockReturnValue({
      data: allowance({
        window_started_at: "2026-10-23T08:00:00Z",
        used_cents: null,
        remaining_cents: null,
      }),
    })
    render(<PlanOverviewSection summary={summary} />)
    expect(screen.getByText("Remaining allowance is unavailable.")).toBeTruthy()
    expect(screen.queryByText(/equivalent remaining/)).toBeNull()
  })

  it("keeps the monetary allowance visible if team pricing is unavailable", () => {
    mocks.plan.mockReturnValue({
      data: plan({ key: "free", kind: "free", name: "Free" }),
    })
    mocks.pricing.mockReturnValue({ data: undefined })
    mocks.allowance.mockReturnValue({ data: allowance({}) })
    render(<PlanOverviewSection summary={summary} />)
    expect(screen.getByText(/allowance remaining/)).toBeTruthy()
    expect(screen.queryByText(/equivalent remaining/)).toBeNull()
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
    render(<PlanOverviewSection summary={summary} />)
    expect(screen.getByText("$42.50")).toBeTruthy()
    expect(
      screen.getByRole("link", { name: "Add more" }).getAttribute("href"),
    ).toBe("/plan-usage/buy-credit")
    expect(screen.queryByText("Current plan")).toBeNull()
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
    expect(
      screen.getByText("No runtime allowance applies to your team right now."),
    ).toBeTruthy()
    expect(screen.queryByText(/couldn't be loaded/)).toBeNull()
  })

  it("never rounds an unspent allowance down to zero", () => {
    mocks.plan.mockReturnValue({
      data: plan({ key: "free", kind: "free", name: "Free" }),
      isError: false,
    })
    mocks.allowance.mockReturnValue({
      data: allowance({
        window_started_at: "2026-10-23T08:00:00Z",
        resets_at: "2026-10-24T08:00:00Z",
        used_cents: 13.3,
        remaining_cents: 0.02,
      }),
    })
    render(<PlanOverviewSection summary={summary} />)
    expect(screen.getByText(/Less than 1 minute/)).toBeTruthy()
  })

  it("says when auto-recharge was turned off and when a top-up is in flight", () => {
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
        balance_cents: 1000,
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
    render(<PlanOverviewSection summary={summary} />)
    expect(screen.getByText(/Auto-recharge was turned off\./)).toBeTruthy()
    expect(screen.queryByText(/card_declined/)).toBeNull()
    expect(screen.getByText("A top-up is being processed.")).toBeTruthy()
  })

  it("shows a scheduled downgrade", () => {
    mocks.plan.mockReturnValue({
      data: plan({
        pending_change: {
          id: "34971786-dd50-492b-b934-306b63764c4b",
          pauses_running: false,
          plan_key: "free",
          plan_name: "Free",
          effective_at: "2026-11-01T00:00:00Z",
          undoable: true,
        },
      }),
      isError: false,
    })
    render(<PlanOverviewSection summary={summary} details />)
    expect(screen.getByText("Change scheduled")).toBeTruthy()
    expect(screen.getByText("Changes to Free on Nov 1, 2026.")).toBeTruthy()
  })

  it("keeps the legacy card for legacy teams and fails closed on unknown plans", () => {
    mocks.plan.mockReturnValue({
      data: plan({ key: "legacy", kind: "legacy_payg", name: "Pay as you go" }),
      isError: false,
    })
    const { unmount } = render(<PlanOverviewSection summary={summary} />)
    expect(screen.getByTestId("legacy-plan")).toBeTruthy()
    unmount()
    mocks.plan.mockReturnValue({ data: undefined, isError: true })
    render(<PlanOverviewSection summary={summary} />)
    expect(screen.getByText("Your plan could not be loaded.")).toBeTruthy()
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

describe("a summary that disagrees with the plan", () => {
  const pending = {
    ...summary,
    plan: {
      ...summary.plan!,
      status: "pending",
      starts_at: "2026-11-01T00:00:00Z",
      included_usage: null,
    },
  } as BillingSummaryResponse

  const recent = () => new Date(Date.now() - 60_000).toISOString()

  it.each([
    ["is still pending", pending, "2026-10-01T00:00:00Z"],
    [
      "names another plan just after the plan changed",
      { ...summary, plan: { ...summary.plan!, key: "other_monthly" } },
      recent(),
    ],
  ])("shows loading while the summary %s", (_, changed, effective_from) => {
    mocks.plan.mockReturnValue({
      data: plan({ effective_from }),
      isError: false,
    })
    render(<PlanOverviewSection summary={changed as BillingSummaryResponse} />)
    expect(screen.getByText("Loading your plan…")).toBeTruthy()
    expect(screen.queryByText(/of \$250 used|couldn't be loaded/)).toBeNull()
  })

  it.each([
    ["a renewal under another key", "pro_annual", "active"],
    ["a lapsed contract falling back to Free", "free", "active"],
    ["a trial fallback", "trial", "trial"],
  ])("renders %s normally once the plan has settled", (_, key, status) => {
    mocks.plan.mockReturnValue({
      data: plan({ key: "yc_2026" }),
      isError: false,
    })
    render(
      <PlanOverviewSection
        summary={
          {
            ...summary,
            plan: { ...summary.plan!, key, status },
          } as BillingSummaryResponse
        }
      />,
    )
    expect(screen.queryByText("Loading your plan…")).toBeNull()
    expect(screen.getByText("Usage couldn't be loaded.")).toBeTruthy()
  })

  it("leaves credit plans alone, which have no contract to compare", () => {
    mocks.plan.mockReturnValue({
      data: plan({ kind: "prepaid" }),
      isError: false,
    })
    render(<PlanOverviewSection summary={pending} />)
    expect(screen.queryByText("Loading your plan…")).toBeNull()
  })
})

describe("Settings plan details", () => {
  it("manages Auto Topoff here and says how to cancel a credit-funded plan", () => {
    mocks.plan.mockReturnValue({
      data: plan({
        funding_policy: "prepaid",
        topoff: {
          amount_cents: 300,
          threshold_cents: 200,
          default_enabled: true,
        },
      }),
      isError: false,
    })
    render(
      <QueryClientProvider client={new QueryClient()}>
        <PlanOverviewSection summary={summary} details />
      </QueryClientProvider>,
    )
    expect(document.getElementById("auto-topoff")).toBeTruthy()
    expect(screen.getByRole("switch")).toBeTruthy()
    expect(screen.getByText(/To cancel, contact support/).textContent).toBe(
      "To cancel, contact support at support@superserve.ai.",
    )
  })

  it("scrolls to Auto Topoff once it loads when a link asked for it", () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    window.history.replaceState({}, "", "/settings/#auto-topoff")
    mocks.plan.mockReturnValue({
      data: plan({ funding_policy: "prepaid", topoff: null }),
      isError: false,
    })
    render(
      <QueryClientProvider client={new QueryClient()}>
        <PlanOverviewSection summary={summary} details />
      </QueryClientProvider>,
    )
    expect(scroll).toHaveBeenCalledOnce()
    expect(scroll.mock.contexts[0]).toBe(document.getElementById("auto-topoff"))
    window.history.replaceState({}, "", "/")
  })

  it("follows the catalog family over funding for how to cancel", () => {
    mocks.offers = [
      {
        offer_key: "developer_monthly",
        family: "developer",
        display_name: "Builder",
        price_cents: 900,
        interval_months: 1,
        included_credit_cents: 900,
        funding_policy: "postpaid",
        topoff: null,
        sellable: true,
      },
    ]
    mocks.plan.mockReturnValue({
      data: plan({ key: "developer_monthly" }),
      isError: false,
    })
    render(
      <QueryClientProvider client={new QueryClient()}>
        <PlanOverviewSection summary={summary} details />
      </QueryClientProvider>,
    )
    expect(screen.getByText(/To cancel/).textContent).toBe(
      "To cancel, contact support at support@superserve.ai.",
    )
  })

  it("points Pro teams to priority Slack or email to cancel", () => {
    mocks.plan.mockReturnValue({ data: plan({}), isError: false })
    render(
      <QueryClientProvider client={new QueryClient()}>
        <PlanOverviewSection summary={summary} details />
      </QueryClientProvider>,
    )
    expect(screen.getByText(/To cancel/).textContent).toBe(
      "To cancel, contact support in your priority Slack channel or at support@superserve.ai.",
    )
    expect(document.getElementById("auto-topoff")).toBeNull()
  })

  it.each([0, 3])(
    "never shows the internal template cap %s, usage or guesses",
    (max_templates) => {
      mocks.plan.mockReturnValue({
        data: plan({
          key: "free",
          kind: "free",
          name: "Free",
          limits: { ...plan({}).limits, max_templates },
        }),
      })
      render(<PlanOverviewSection summary={summary} details />)
      expect(screen.getByText("Free")).toBeTruthy()
      expect(screen.queryByText("Custom templates")).toBeNull()
      expect(screen.queryByText(/disk/)).toBeNull()
      expect(
        screen.getByRole("link", { name: "Change plan" }).getAttribute("href"),
      ).toBe("/plan-usage/upgrade")
      expect(screen.queryByText("Usage limits")).toBeNull()
      expect(mocks.allowance).toHaveBeenCalledWith(false)
      expect(mocks.pricing).toHaveBeenCalledWith(false)
    },
  )
  it("retains an unknown plan loading failure without a family guess", () => {
    mocks.plan.mockReturnValue({ data: undefined, isError: true })
    render(<PlanOverviewSection summary={summary} details />)
    expect(screen.getByText("Your plan could not be loaded.")).toBeTruthy()
    expect(screen.queryByText("Free")).toBeNull()
    expect(screen.queryByText("Usage-based billing")).toBeNull()
  })
  it("puts Starter configuration in Settings and hides management from viewers", () => {
    mocks.plan.mockReturnValue({
      data: plan({ key: "starter", kind: "prepaid", name: "Starter" }),
    })
    const { unmount } = render(
      <PlanOverviewSection summary={summary} details />,
    )
    expect(
      screen
        .getByRole("link", { name: "Manage auto-recharge" })
        .getAttribute("href"),
    ).toBe("/plan-usage/buy-credit")
    expect(screen.queryByRole("link", { name: "Add more" })).toBeNull()
    unmount()
    render(
      <PlanOverviewSection
        summary={{
          ...summary,
          permissions: { can_view: true, can_manage: false },
        }}
        details
      />,
    )
    expect(
      screen.queryByRole("link", { name: "Manage auto-recharge" }),
    ).toBeNull()
    expect(screen.queryByRole("link", { name: "Change plan" })).toBeNull()
  })
})

it("keeps Settings recovery and recharge-disable navigation when capabilities are unavailable", () => {
  mocks.capabilitiesUnavailable = true
  mocks.plan.mockReturnValue({
    data: plan({ key: "starter", name: "Starter", kind: "prepaid" }),
    isError: false,
  })
  render(<PlanOverviewSection summary={summary} details />)
  expect(screen.getByRole("link", { name: "Change plan" })).toHaveAttribute(
    "href",
    "/plan-usage/upgrade",
  )
  expect(
    screen.getByRole("link", { name: "Manage auto-recharge" }),
  ).toHaveAttribute("href", "/plan-usage/buy-credit")
})

it("doesn't promise postpaid overages for a credit-funded plan", () => {
  mocks.plan.mockReturnValue({
    data: plan({
      key: "developer_monthly",
      name: "Developer",
      funding_policy: "prepaid",
      topoff: {
        amount_cents: 2500,
        threshold_cents: 1000,
        default_enabled: false,
      },
    }),
    isError: false,
  })
  render(
    <PlanOverviewSection
      summary={{
        ...summary,
        plan: { ...summary.plan!, key: "developer_monthly" },
      }}
    />,
  )
  expect(
    screen.queryByText(/beyond the included usage, billed at usage rates/),
  ).toBeNull()
  expect(screen.queryByText(/at the end of the period/)).toBeNull()
})
