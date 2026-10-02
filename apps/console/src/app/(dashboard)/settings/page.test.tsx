import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type {
  BillingPricingResponse,
  BillingSummaryResponse,
} from "@/lib/api/billing"

import SettingsPage from "./page"

const useUser = vi.fn()
const useBillingSummary = vi.fn()
const useBillingSettings = vi.fn()

vi.mock("@/hooks/use-user", () => ({
  useUser: () => useUser(),
}))

vi.mock("@/hooks/use-billing-summary", () => ({
  useBillingSummary: (...args: unknown[]) => useBillingSummary(...args),
}))

vi.mock("@/hooks/use-billing-usage", () => ({
  useBillingSettings: (...args: unknown[]) => useBillingSettings(...args),
}))

vi.mock("@/components/settings/teams-section", () => ({
  TeamsSection: () => null,
}))

vi.mock("@/lib/supabase/client", () => ({
  createBrowserClient: () => ({
    auth: {
      updateUser: vi.fn(),
      signInWithPassword: vi.fn(),
    },
  }),
}))

vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: vi.fn() }),
}))

vi.mock("@superserve/ui", async () => {
  const actual =
    await vi.importActual<typeof import("@superserve/ui")>("@superserve/ui")
  return {
    ...actual,
    useToast: () => ({ addToast: vi.fn() }),
  }
})

const summary = (storageBillable: boolean): BillingSummaryResponse => ({
  billing_mode: "live",
  checkout_available: true,
  portal_available: true,
  payment_setup_required: false,
  permissions: { can_view: true, can_manage: true },
  current_charges_usd: storageBillable ? 12.34 : 0,
  credits_applied_usd: 0,
  credits_remaining_usd: 0,
  expected_invoice_amount_usd: storageBillable ? 12.34 : 0,
  cost_breakdown_usd: {
    compute: 1,
    memory: 2,
    storage: storageBillable ? 3 : 0,
  },
  resources: [
    {
      resource_key: "vcpu",
      resource: "cpu",
      display_name: "CPU",
      sort_order: 10,
      unit: "second",
      display_unit: "vCPU-hours",
      usage: 1,
      tracked: true,
      billable: true,
      charge_usd: 1,
    },
    {
      resource_key: "memory_gib",
      resource: "memory",
      display_name: "Memory",
      sort_order: 20,
      unit: "second",
      display_unit: "GiB-hours",
      usage: 2,
      tracked: true,
      billable: true,
      charge_usd: 2,
    },
    {
      resource_key: "storage_gib",
      resource: "storage",
      display_name: "Storage",
      sort_order: 30,
      unit: "second",
      display_unit: "GiB-hours",
      usage: 100,
      tracked: true,
      billable: storageBillable,
      charge_usd: storageBillable ? 0 : 4.56,
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
  calculated_at: "2026-06-30T12:00:00.000Z",
})

const pricing: BillingPricingResponse = {
  plan_key: "payg",
  plan_name: "Pay-as-you-go",
  currency: "USD",
  rates: [
    {
      resource_key: "vcpu",
      resource: "cpu",
      display_name: "CPU",
      sort_order: 10,
      unit: "second",
      display_unit: "vCPU-hour",
      price_usd: 0.00002,
      price_usd_hourly: 0.072,
      effective_from: "2026-06-01T00:00:00.000Z",
      tracked: true,
      billable: true,
    },
    {
      resource_key: "memory_gib",
      resource: "memory",
      display_name: "Memory",
      sort_order: 20,
      unit: "second",
      display_unit: "GiB-hour",
      price_usd: 0.000004,
      price_usd_hourly: 0.0144,
      effective_from: "2026-06-01T00:00:00.000Z",
      tracked: true,
      billable: true,
    },
    {
      resource_key: "storage_gib",
      resource: "storage",
      display_name: "Storage",
      sort_order: 30,
      unit: "second",
      display_unit: "GiB-hour",
      price_usd: 0.00000003,
      price_usd_hourly: 0.000108,
      effective_from: "2026-06-01T00:00:00.000Z",
      tracked: true,
      // Pricing eligibility is deliberately not used by Settings.
      billable: false,
    },
  ],
}

function renderPage() {
  return render(<SettingsPage />)
}

describe("Settings billing", () => {
  beforeEach(() => {
    useUser.mockReturnValue({
      user: {
        id: "user-1",
        email: "user@example.com",
        user_metadata: {},
        app_metadata: {},
      },
      loading: false,
    })
    useBillingSettings.mockReturnValue({
      data: pricing,
      isPending: false,
      error: null,
    })
    useBillingSummary.mockReturnValue({
      data: summary(false),
      isPending: false,
      error: null,
    })
  })

  it("shows tracked-only storage even when a positive rate exists", () => {
    renderPage()

    expect(screen.getByText("Billing")).toBeInTheDocument()
    expect(screen.getByText("Tracked only · Not billed")).toBeInTheDocument()
    expect(screen.getByText("$0.000108 / GiB-hour")).toBeInTheDocument()
  })

  it("shows billable storage as billed even at zero charge", () => {
    useBillingSummary.mockReturnValue({
      data: summary(true),
      isPending: false,
      error: null,
    })

    renderPage()

    expect(screen.getByText("Billed")).toBeInTheDocument()
    expect(
      screen.queryByText("Tracked only · Not billed"),
    ).not.toBeInTheDocument()
    expect(screen.getByText("$0.000108 / GiB-hour")).toBeInTheDocument()
  })

  it("preserves CPU and memory rates while billing is available", () => {
    renderPage()

    expect(screen.getByText("$0.0720 / vCPU-hour")).toBeInTheDocument()
    expect(screen.getByText("$0.0144 / GiB-hour")).toBeInTheDocument()
  })

  it("fails closed when the summary is unavailable or view permission is denied", () => {
    useBillingSummary.mockReturnValue({
      data: undefined,
      isPending: false,
      error: new Error("unavailable"),
    })
    const view = renderPage()
    expect(view.queryByText("Usage-based billing")).not.toBeInTheDocument()

    useBillingSummary.mockReturnValue({
      data: {
        ...summary(false),
        permissions: { can_view: false, can_manage: false },
      },
      isPending: false,
      error: null,
    })
    view.rerender(<SettingsPage />)
    expect(view.queryByText("Usage-based billing")).not.toBeInTheDocument()
  })
})
