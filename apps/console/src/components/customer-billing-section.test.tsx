vi.mock("@/hooks/use-billing-capabilities", () => ({
  useBillingCapabilities: () => ({
    data: {
      pricing_version: "legacy",
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

import { CustomerBillingSection } from "./customer-billing-section"

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
    sessionStorage.clear()
    addToast.mockReset()
    createStripeCheckoutSession.mockReset()
    createStripeCustomerPortalSession.mockReset()
    publishBillingPromotionEvidence.mockReset().mockResolvedValue("published")
    useCustomerBillingPeriods.mockReset()
    window.history.replaceState({}, "", "/plan-usage")
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
    renderSection()

    expect(screen.getByText("Open Customer Portal")).toBeInTheDocument()
    expect(screen.queryByText("Billing is live")).not.toBeInTheDocument()
    expect(screen.queryByText("Tracking only")).not.toBeInTheDocument()
    expect(screen.getByText("Connected")).toBeInTheDocument()
    expect(
      screen.getByText("Stripe is ready to invoice this team."),
    ).toBeInTheDocument()
  })

  it("keeps payment status neutral while the authoritative summary is unavailable", () => {
    renderSection(null)

    expect(screen.getByText("Payment Status")).toBeInTheDocument()
    expect(screen.getAllByText("Unavailable")).toHaveLength(1)
    expect(
      screen.getByText("Billing data is unavailable for this team right now."),
    ).toBeInTheDocument()
    expect(screen.queryByText("Tracking only")).not.toBeInTheDocument()
  })

  it("disables the CTA while billing periods are still loading", () => {
    useCustomerBillingPeriods.mockReturnValue({
      data: undefined,
      isPending: true,
      isFetching: true,
      error: null,
    })

    renderSection()

    expect(screen.getByRole("button", { name: /loading/i })).toBeDisabled()
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
      renderSection({ ...baseSummary, portal_available: portalAvailable })

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
    window.history.replaceState({}, "", "/plan-usage?billing=success")

    renderSection()

    expect(screen.getByText("Returned from Stripe")).toBeInTheDocument()
    expect(
      screen.getByText(
        "Billing status is refreshing against the latest server state.",
      ),
    ).toBeInTheDocument()
  })

  it.each(["paid", "open", "uncollectible", "void"])(
    "retains invoice history and actionable %s state",
    (status) => {
      useCustomerBillingPeriods.mockReturnValue({
        data: {
          periods: [
            {
              period_id: "test",
              period_start: "2026-06-01T00:00:00Z",
              period_end: "2026-07-01T00:00:00Z",
              status: "active",
              stripe_subscription_status: "active",
              stripe_invoice_status: status,
            },
          ],
        },
        isPending: false,
        isFetching: false,
        error: null,
      })
      renderSection()
      expect(screen.queryByText("Billing is live")).not.toBeInTheDocument()
      expect(
        screen.getByRole("button", { name: "Open Customer Portal" }),
      ).toBeEnabled()
      if (status === "paid") {
        expect(screen.queryByText("Payment Status")).not.toBeInTheDocument()
        expect(screen.queryByText("Connected")).not.toBeInTheDocument()
      } else {
        expect(screen.getByText("Payment Status")).toBeInTheDocument()
      }
    },
  )
  it.each([
    { label: "pending period", status: "pending" },
    { label: "failed period", status: "failed" },
    {
      label: "blocked period",
      status: "active",
      blocked_reason: "Payment reconciliation pending",
    },
    {
      label: "pending subscription",
      status: "active",
      stripe_subscription_status: "incomplete",
    },
    {
      label: "failed subscription",
      status: "active",
      stripe_subscription_status: "past_due",
    },
    {
      label: "scheduled cancellation",
      status: "active",
      cancel_at_period_end: true,
    },
  ])("keeps payment status for $label", ({ label: _label, ...period }) => {
    useCustomerBillingPeriods.mockReturnValue({
      data: {
        periods: [
          {
            period_id: "test",
            period_start: "2026-06-01T00:00:00Z",
            period_end: "2026-07-01T00:00:00Z",
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
    renderSection()
    expect(screen.getByText("Payment Status")).toBeInTheDocument()
  })

  it("keeps disconnected payment and setup recovery visible", () => {
    renderSection({
      ...baseSummary,
      portal_available: false,
      payment_setup_required: true,
    })
    expect(screen.getByText("Payment setup required")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Set Up Billing" })).toBeEnabled()
  })
})
