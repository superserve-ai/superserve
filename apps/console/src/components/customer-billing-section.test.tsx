vi.mock("@/hooks/use-billing-capabilities", () => ({
  useBillingCapabilities: () => ({
    data: mocks.capabilitiesPending
      ? undefined
      : {
          pricing_version: mocks.pricingVersion,
          offers: mocks.offers,
          entry_open: false,
          fresh_entry: {
            starter: false,
            pro: false,
            auto_recharge: false,
            choose_free: false,
          },
        },
  }),
}))
vi.mock("@/hooks/use-user", () => ({
  useUser: () => ({ user: { id: "u1" }, loading: false }),
}))
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { BillingSummaryResponse } from "@/lib/api/billing"
import type { SignupPlanContext } from "@/lib/api/signup-plan"
import { AWAITING_PLAN_STATES } from "@/lib/billing/signup-checkout-paths"

import {
  CustomerBillingSection,
  billingProblem,
  usePlanBillingControls,
} from "./customer-billing-section"

const mocks = vi.hoisted(() => ({
  entry: vi.fn(),
  pricingVersion: "legacy" as "legacy" | "v2",
  capabilitiesPending: false,
  offers: undefined as unknown[] | undefined,
  scope: "self",
}))

vi.mock("@/hooks/use-billing-v2", () => ({
  useTeamEntry: mocks.entry,
}))
vi.mock("@/hooks/use-billing-context", () => ({
  useBillingContext: () => ({
    teamKey: "use:team-1",
    cacheScope: mocks.scope,
    ready: true,
  }),
}))
vi.mock("@/components/query-provider", async (original) => ({
  ...(await original<typeof import("@/components/query-provider")>()),
  useQueryScope: () => mocks.scope,
}))

const useCustomerBillingPeriods = vi.fn()
const createStripeCheckoutSession = vi.fn()
const createStripeCustomerPortalSession = vi.fn()
const publishBillingPromotionEvidence = vi.fn()
const addToast = vi.fn()

const baseSummary: BillingSummaryResponse = {
  billing_mode: "live" as const,
  checkout_available: true,
  portal_available: true,
  payment_setup_required: false,
  permissions: {
    can_view: true,
    can_manage: true,
  },
  current_charges_usd: 123.45,
  credits_applied_usd: 23.45,
  credits_remaining_usd: 76.55,
  expected_invoice_amount_usd: 100,
  cost_breakdown_usd: {
    compute: 60,
    memory: 40,
    storage: 23.45,
  },
  resources: [
    {
      resource_key: "vcpu",
      resource: "cpu",
      display_name: "CPU",
      sort_order: 10,
      unit: "second",
      display_unit: "vCPU-hours",
      usage: 120,
      tracked: true,
      billable: true,
      charge_usd: 60,
    },
    {
      resource_key: "memory_gib",
      resource: "memory",
      display_name: "Memory",
      sort_order: 20,
      unit: "second",
      display_unit: "GiB-hours",
      usage: 2_048_000,
      tracked: true,
      billable: true,
      charge_usd: 40,
    },
    {
      resource_key: "storage_gib",
      resource: "storage",
      display_name: "Storage",
      sort_order: 30,
      unit: "second",
      display_unit: "GiB-hours",
      usage: 4_096_000,
      tracked: true,
      billable: false,
      charge_usd: 0,
    },
  ],
  billing_period: {
    start: "2026-06-01T00:00:00.000Z",
    end: "2026-07-01T00:00:00.000Z",
  },
  pricing_tier: {
    plan_key: "payg",
    plan_name: "Pay-as-you-go",
    currency: "USD",
  },
  calculated_at: "2026-06-30T12:30:00.000Z",
}

vi.mock("@/hooks/use-customer-billing", () => ({
  useCustomerBillingPeriods: (...args: unknown[]) =>
    useCustomerBillingPeriods(...args),
}))

vi.mock("@/lib/api/billing-stripe", () => ({
  createStripeCheckoutSession: (...args: unknown[]) =>
    createStripeCheckoutSession(...args),
  createStripeCustomerPortalSession: (...args: unknown[]) =>
    createStripeCustomerPortalSession(...args),
}))

vi.mock("@/lib/api/billing-actions", () => ({
  publishBillingPromotionEvidence: () => publishBillingPromotionEvidence(),
}))

vi.mock("@superserve/ui", async () => {
  const actual =
    await vi.importActual<typeof import("@superserve/ui")>("@superserve/ui")
  return {
    ...actual,
    useToast: () => ({ addToast }),
  }
})

function PlanBillingControls({
  summary,
}: {
  summary: BillingSummaryResponse | null
}) {
  return usePlanBillingControls({
    team: { teamId: "team-1", region: "use" },
    summary,
  })
}

function renderControls(
  summary: BillingSummaryResponse | null = baseSummary,
  signup?: SignupPlanContext,
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })
  if (signup) queryClient.setQueryData(["signup-plan", "use:team-1"], signup)

  return render(
    <QueryClientProvider client={queryClient}>
      <PlanBillingControls summary={summary} />
    </QueryClientProvider>,
  )
}

function mockLatestPeriod(period: Record<string, unknown>) {
  useCustomerBillingPeriods.mockReturnValue({
    data: {
      periods: [
        {
          period_id: "test",
          period_start: "2026-06-01T00:00:00Z",
          period_end: "2026-07-01T00:00:00Z",
          status: "active",
          stripe_subscription_status: "active",
          stripe_invoice_status: "paid",
          ...period,
        },
      ],
    },
    isPending: false,
    isFetching: false,
    error: null,
  })
}

function renderSection(
  summary: BillingSummaryResponse | null = baseSummary,
  cardless = false,
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <CustomerBillingSection
        teamId="team-1"
        teamRegion="use"
        teamName="Pilot Team"
        summary={summary}
        cardless={cardless}
      />
    </QueryClientProvider>,
  )
}

describe("CustomerBillingSection", () => {
  beforeEach(() => {
    mocks.entry.mockReset().mockReturnValue({
      data: null,
      isPending: false,
      isError: false,
    })
    mocks.pricingVersion = "legacy"
    mocks.capabilitiesPending = false
    mocks.offers = undefined
    mocks.scope = "self"
    sessionStorage.clear()
    addToast.mockReset()
    createStripeCheckoutSession.mockReset()
    createStripeCustomerPortalSession.mockReset()
    publishBillingPromotionEvidence.mockReset().mockResolvedValue("published")
    useCustomerBillingPeriods.mockReset()
    window.history.replaceState({}, "", "/billing-usage")
    useCustomerBillingPeriods.mockReturnValue({
      data: {
        periods: [
          {
            period_id: "older",
            period_start: "2026-05-01T00:00:00.000Z",
            period_end: "2026-06-01T00:00:00.000Z",
            status: "exported",
            stripe_subscription_status: "trialing",
          },
          {
            period_id: "newer",
            period_start: "2026-06-01T00:00:00.000Z",
            period_end: "2026-07-01T00:00:00.000Z",
            status: "active",
            stripe_subscription_id: "sub_test",
            stripe_customer_id: "cus_test",
            stripe_subscription_status: "active",
            stripe_invoice_status: "open",
          },
        ],
      },
      isPending: false,
      isFetching: false,
      error: null,
    })
  })

  it("preserves historical periods, credits and portal on Free without setup prompts", async () => {
    renderSection({ ...baseSummary, payment_setup_required: true }, true)
    expect(screen.getByText("Billing account")).toBeInTheDocument()
    expect(screen.getByText("Credits remaining: $76.55")).toBeInTheDocument()
    expect(
      screen.getByText("Current billing period estimate: $100.00"),
    ).toBeInTheDocument()
    expect(
      screen.queryByText(/Outstanding balance|Overdue balance/),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Open Customer Portal" }),
    ).toBeEnabled()
    expect(
      screen.queryByText(
        /Payment setup required|Set Up Billing|Billing setup pending/,
      ),
    ).not.toBeInTheDocument()
  })
  it("keeps a fresh Free account free of payment widgets", () => {
    useCustomerBillingPeriods.mockReturnValue({
      data: { periods: [] },
      isPending: false,
      error: null,
    })
    renderSection(
      {
        ...baseSummary,
        portal_available: false,
        checkout_available: true,
        payment_setup_required: true,
        credits_remaining_usd: 0,
        expected_invoice_amount_usd: 0,
      },
      true,
    )
    expect(
      screen.queryByTestId("customer-billing-section"),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /Set Up Billing|Portal/ }),
    ).not.toBeInTheDocument()
  })

  it("uses the latest billing period even when the API returns unsorted rows", () => {
    useCustomerBillingPeriods.mockReturnValue({
      data: {
        periods: [
          {
            period_id: "newer",
            period_start: "2026-06-01T00:00:00.000Z",
            period_end: "2026-07-01T00:00:00.000Z",
            status: "active",
            stripe_subscription_status: "active",
            stripe_invoice_status: "draft",
          },
          {
            period_id: "older",
            period_start: "2026-05-01T00:00:00.000Z",
            period_end: "2026-06-01T00:00:00.000Z",
            status: "exported",
            stripe_subscription_status: "past_due",
          },
        ],
      },
      isPending: false,
      isFetching: false,
      error: null,
    })
    renderControls()

    expect(
      screen.getByRole("button", { name: "Open Customer Portal" }),
    ).toBeEnabled()
    expect(screen.queryByTestId("plan-billing-problem")).not.toBeInTheDocument()
  })

  it("no longer renders a separate payment status card for a connected team", () => {
    renderSection()

    expect(
      screen.queryByTestId("customer-billing-section"),
    ).not.toBeInTheDocument()
    expect(screen.queryByText("Payment Status")).not.toBeInTheDocument()
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
  })

  it("renders no billing controls while the authoritative summary is unavailable", () => {
    renderControls(null)
    expect(
      screen.queryByTestId("plan-billing-controls"),
    ).not.toBeInTheDocument()
    renderSection(null)
    expect(
      screen.queryByTestId("customer-billing-section"),
    ).not.toBeInTheDocument()
  })

  it("disables the CTA while billing periods are still loading", () => {
    useCustomerBillingPeriods.mockReturnValue({
      data: undefined,
      isPending: true,
      isFetching: true,
      error: null,
    })

    renderControls()

    expect(screen.getByRole("button", { name: /loading/i })).toBeDisabled()
  })

  it("shows view-only copy instead of an action for members without billing rights", () => {
    renderControls({
      ...baseSummary,
      permissions: { can_view: true, can_manage: false },
    })

    expect(
      screen.getByText("Billing is view-only for your role."),
    ).toBeInTheDocument()
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
  })

  it.each([
    { portalAvailable: false, label: "Set Up Billing" },
    { portalAvailable: true, label: "Open Customer Portal" },
  ])(
    "opens the shared payment flow from $label",
    async ({ portalAvailable, label }) => {
      const request = portalAvailable
        ? createStripeCustomerPortalSession
        : createStripeCheckoutSession
      let reject!: (reason: Error) => void
      request.mockReturnValueOnce(
        new Promise((_resolve, rej) => {
          reject = rej
        }),
      )
      renderControls({ ...baseSummary, portal_available: portalAvailable })

      const button = screen.getByRole("button", { name: label })
      expect(button).toBeEnabled()
      await act(async () => {
        fireEvent.click(button)
      })
      expect(request).toHaveBeenCalledTimes(1)
      const returnUrl = new URL(window.location.href)
      if (portalAvailable) {
        returnUrl.searchParams.set("billing_flow", "portal-return")
        expect(request).toHaveBeenCalledWith({
          returnUrl: returnUrl.toString(),
        })
        expect(createStripeCheckoutSession).not.toHaveBeenCalled()
      } else {
        const cancelUrl = new URL(returnUrl)
        returnUrl.searchParams.set("billing_flow", "success")
        cancelUrl.searchParams.set("billing_flow", "cancel")
        expect(request).toHaveBeenCalledWith({
          intentScope: expect.any(String),
          successUrl: returnUrl.toString(),
          cancelUrl: cancelUrl.toString(),
        })
        expect(createStripeCustomerPortalSession).not.toHaveBeenCalled()
      }
      expect(screen.getByRole("button", { name: /loading/i })).toBeDisabled()
      fireEvent.click(button)
      expect(request).toHaveBeenCalledTimes(1)

      await act(async () => {
        reject(new Error("Stripe unavailable"))
      })
      await waitFor(() => {
        expect(addToast).toHaveBeenCalledWith("Stripe unavailable", "error")
        expect(screen.getByRole("button", { name: label })).toBeEnabled()
      })
    },
  )

  it("shows shadow mode messaging and blocks billing actions", () => {
    const shadowSummary = {
      ...baseSummary,
      billing_mode: "shadow" as const,
      checkout_available: false,
      portal_available: false,
      payment_setup_required: true,
      permissions: {
        can_view: true,
        can_manage: true,
      },
      resources: [
        {
          resource_key: "storage_gib",
          resource: "storage",
          display_name: "Storage",
          sort_order: 30,
          unit: "second",
          display_unit: "GiB-hours",
          usage: 4_096_000,
          tracked: true,
          billable: false,
          charge_usd: 0,
        },
      ],
    }
    useCustomerBillingPeriods.mockReturnValue({
      data: {
        periods: [
          {
            period_id: "shadow",
            period_start: "2026-06-01T00:00:00.000Z",
            period_end: "2026-07-01T00:00:00.000Z",
            status: "exported",
            stripe_subscription_status: "trialing",
          },
        ],
      },
      isPending: false,
      isFetching: false,
      error: null,
    })
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <CustomerBillingSection
          teamId="team-1"
          teamRegion="use"
          teamName="Pilot Team"
          summary={shadowSummary}
        />
      </QueryClientProvider>,
    )

    expect(screen.getByRole("alert")).toHaveTextContent("Tracking only")
    expect(
      screen.getByText(
        "Usage is tracked at standard rates, but this team is not charged yet.",
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
  })

  it("shows a refresh notice when returning from Stripe", () => {
    window.history.replaceState({}, "", "/billing-usage?billing=success")

    renderSection()

    expect(screen.getByText("Returned from Stripe")).toBeInTheDocument()
    expect(
      screen.getByText(
        "Billing status is refreshing against the latest server state.",
      ),
    ).toBeInTheDocument()
  })

  it.each([
    { status: "paid", problem: null },
    { status: "draft", problem: null },
    { status: "open", problem: null },
    { status: "void", problem: null },
    {
      status: "uncollectible",
      problem:
        "The latest invoice could not be collected. Update your payment method in the customer portal.",
    },
  ])(
    "keeps the portal and flags only a problem invoice: $status",
    ({ status, problem }) => {
      mockLatestPeriod({ stripe_invoice_status: status })
      renderControls()
      expect(
        screen.getByRole("button", { name: "Open Customer Portal" }),
      ).toBeEnabled()
      if (problem) {
        expect(screen.getByTestId("plan-billing-problem")).toHaveTextContent(
          problem,
        )
      } else {
        expect(
          screen.queryByTestId("plan-billing-problem"),
        ).not.toBeInTheDocument()
      }
    },
  )

  it.each([
    {
      label: "pending period",
      period: { status: "pending" },
      problem: "Billing for the current period is still processing.",
    },
    {
      label: "failed period",
      period: { status: "failed" },
      problem: "Billing for the current period failed.",
    },
    {
      label: "pending subscription",
      period: { stripe_subscription_status: "incomplete" },
      problem: "The subscription is waiting for payment confirmation.",
    },
    {
      label: "failed subscription",
      period: { stripe_subscription_status: "past_due" },
      problem:
        "The last payment failed. Update your payment method in the customer portal.",
    },
    {
      label: "canceled subscription",
      period: { stripe_subscription_status: "canceled" },
      problem: "The subscription is canceled.",
    },
    {
      label: "scheduled cancellation",
      period: { cancel_at_period_end: true },
      problem:
        "Billing is scheduled to end at the close of the current period.",
    },
  ])("shows a plan card status line for a $label", ({ period, problem }) => {
    mockLatestPeriod(period)
    renderControls()
    expect(screen.getByTestId("plan-billing-problem")).toHaveTextContent(
      problem,
    )
    expect(
      screen.getByRole("button", { name: "Open Customer Portal" }),
    ).toBeEnabled()
  })

  it("keeps a blocked period notice outside the plan card", () => {
    mockLatestPeriod({ blocked_reason: "Payment reconciliation pending" })
    renderSection()
    expect(screen.getByText("Billing setup pending")).toBeInTheDocument()
    expect(
      screen.getByText("Payment reconciliation pending"),
    ).toBeInTheDocument()
  })

  it("keeps disconnected payment and setup recovery visible", () => {
    renderControls({
      ...baseSummary,
      portal_available: false,
      payment_setup_required: true,
    })
    expect(screen.getByTestId("plan-billing-problem")).toHaveTextContent(
      "Payment setup required",
    )
    expect(screen.getByRole("button", { name: "Set Up Billing" })).toBeEnabled()
  })

  it("explains live billing without a customer portal", () => {
    renderControls({
      ...baseSummary,
      portal_available: false,
      checkout_available: false,
    })
    expect(screen.getByTestId("plan-billing-problem")).toHaveTextContent(
      "Billing is live, but no customer portal is currently available.",
    )
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
  })

  it.each(
    AWAITING_PLAN_STATES.flatMap((entry) =>
      [false, true].map((paymentSetupRequired) => ({
        entry,
        paymentSetupRequired,
      })),
    ),
  )(
    "offers an upgrade for $entry with setup required $paymentSetupRequired",
    ({ entry, paymentSetupRequired }) => {
      mocks.pricingVersion = "v2"
      mocks.entry.mockReturnValue({
        data: entry,
        isPending: false,
        isError: false,
      })
      renderControls({
        ...baseSummary,
        portal_available: false,
        payment_setup_required: paymentSetupRequired,
      })

      expect(screen.getByTestId("plan-billing-controls")).toBeInTheDocument()
      expect(
        screen.queryByTestId("plan-billing-problem"),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole("button", { name: "Set Up Billing" }),
      ).not.toBeInTheDocument()
      const upgrade = screen.getByRole("link", { name: "Upgrade" })
      const url = new URL(upgrade.getAttribute("href")!, "https://console.test")
      expect(url.pathname).toMatch(/^\/auth\/choose-plan\/?$/)
      expect(Object.fromEntries(url.searchParams)).toEqual({
        reason: "upgrade",
        account: "u1",
        team: "use:team-1",
      })
    },
  )

  it("uses the requested offer's checkout and offers other plans for a trial", () => {
    mocks.pricingVersion = "v2"
    mocks.entry.mockReturnValue({
      data: "trial",
      isPending: false,
      isError: false,
    })
    mocks.offers = [
      {
        offer_key: "developer_monthly",
        display_name: "Builder",
        sellable: true,
      },
    ]
    renderControls(
      { ...baseSummary, portal_available: false },
      {
        userId: "signup-account",
        teamKey: "use:team-1",
        state: "selecting",
        offer: null,
        requestedOffer: "developer",
      },
    )

    const upgrade = screen.getByRole("button", { name: "Upgrade to Builder" })
    const form = upgrade.closest("form")!
    expect(form).toHaveAttribute("method", "post")
    const action = new URL(form.getAttribute("action")!, "https://console.test")
    expect(action.pathname).toBe("/api/onboarding/checkout/")
    expect(Object.fromEntries(action.searchParams)).toEqual({
      offer: "developer",
      account: "signup-account",
      team: "use:team-1",
    })
    const otherPlans = new URL(
      screen.getByRole("link", { name: "Other plans" }).getAttribute("href")!,
      "https://console.test",
    )
    expect(otherPlans.pathname).toMatch(/^\/auth\/choose-plan\/?$/)
    expect(Object.fromEntries(otherPlans.searchParams)).toEqual({
      reason: "upgrade",
      offer: "developer",
      account: "signup-account",
      team: "use:team-1",
    })
    expect(fireEvent.submit(form)).toBe(true)
    expect(upgrade).toBeDisabled()
    expect(fireEvent.submit(form)).toBe(false)
    expect(screen.queryByTestId("plan-billing-problem")).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Set Up Billing" }),
    ).not.toBeInTheDocument()
  })

  it.each([
    { scope: "self", canManage: false },
    { scope: "impersonated", canManage: true },
  ])(
    "leaves trial upgrades to billing admins in their own scope: $scope, $canManage",
    ({ scope, canManage }) => {
      mocks.pricingVersion = "v2"
      mocks.scope = scope
      mocks.entry.mockReturnValue({
        data: "trial",
        isPending: false,
        isError: false,
      })
      renderControls({
        ...baseSummary,
        portal_available: false,
        payment_setup_required: true,
        permissions: { can_view: true, can_manage: canManage },
      })

      expect(
        screen.getByText("Ask a team billing admin to upgrade."),
      ).toHaveClass("text-xs", "text-muted")
      expect(screen.queryByRole("link")).not.toBeInTheDocument()
      expect(screen.queryByRole("button")).not.toBeInTheDocument()
      expect(
        screen.queryByTestId("plan-billing-problem"),
      ).not.toBeInTheDocument()
    },
  )

  it.each([
    {
      data: undefined,
      isPending: true,
      isError: false,
      fetchStatus: "fetching",
    },
    { data: "activating", isPending: false, isError: false },
  ])(
    "hides all billing controls while entry is $data (pending: $isPending)",
    (entry) => {
      mocks.entry.mockReturnValue(entry)
      const { container } = renderControls({
        ...baseSummary,
        portal_available: false,
        payment_setup_required: true,
      })
      expect(container).toBeEmptyDOMElement()
      expect(mocks.entry).toHaveBeenCalledWith(true)
    },
  )

  it.each(["v2", "pending"] as const)(
    "hides unsupported setup checkout with %s capabilities",
    (pricing) => {
      mocks.pricingVersion = "v2"
      mocks.capabilitiesPending = pricing === "pending"
      renderControls({ ...baseSummary, portal_available: false })
      expect(
        screen.queryByRole("button", { name: "Set Up Billing" }),
      ).not.toBeInTheDocument()
    },
  )

  it("offers working legacy checkout without a missing portal warning", () => {
    renderControls({ ...baseSummary, portal_available: false })
    expect(screen.getByRole("button", { name: "Set Up Billing" })).toBeEnabled()
    expect(screen.queryByTestId("plan-billing-problem")).not.toBeInTheDocument()
  })

  it("keeps paid billing controls when the entry read cannot run", () => {
    mocks.entry.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
      fetchStatus: "idle",
    })
    renderControls()
    expect(
      screen.getByRole("button", { name: "Open Customer Portal" }),
    ).toBeEnabled()
  })

  it("keeps legacy billing recovery when the entry read fails", () => {
    mocks.entry.mockReturnValue({
      data: "trial",
      isPending: false,
      isError: true,
    })
    renderControls({
      ...baseSummary,
      portal_available: false,
      payment_setup_required: true,
    })
    expect(screen.getByRole("button", { name: "Set Up Billing" })).toBeEnabled()
    expect(screen.getByTestId("plan-billing-problem")).toHaveTextContent(
      "Payment setup required",
    )
    expect(
      screen.queryByRole("link", { name: /Upgrade/ }),
    ).not.toBeInTheDocument()
  })
})

describe("billingProblem", () => {
  const disconnected = { ...baseSummary, portal_available: false }

  it.each([undefined, {}, { checkoutReady: false }])(
    "keeps the missing portal warning without working checkout: %j",
    (options) => {
      expect(billingProblem(disconnected, null, options)).toBe(
        "Billing is live, but no customer portal is currently available.",
      )
    },
  )

  it("suppresses the missing portal warning when checkout is ready", () => {
    expect(
      billingProblem(disconnected, null, { checkoutReady: true }),
    ).toBeNull()
  })

  it("keeps payment setup required first even when checkout is ready", () => {
    expect(
      billingProblem({ ...disconnected, payment_setup_required: true }, null, {
        checkoutReady: true,
      }),
    ).toBe(
      "Payment setup required. Start checkout to connect Stripe for this team.",
    )
  })

  it("keeps shadow billing quiet when checkout is ready", () => {
    expect(
      billingProblem({ ...disconnected, billing_mode: "shadow" }, null, {
        checkoutReady: true,
      }),
    ).toBeNull()
  })

  it("keeps subscription problems when a portal exists and checkout is ready", () => {
    expect(
      billingProblem(
        baseSummary,
        {
          status: "active",
          cancel_at_period_end: false,
          stripe_subscription_status: "past_due",
          stripe_invoice_status: "open",
        },
        { checkoutReady: true },
      ),
    ).toBe(
      "The last payment failed. Update your payment method in the customer portal.",
    )
  })
})
