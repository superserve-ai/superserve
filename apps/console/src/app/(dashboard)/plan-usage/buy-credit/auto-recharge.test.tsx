import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { PrepaidCreditSummary } from "@/lib/api/prepaid"

const mocks = vi.hoisted(() => ({
  data: null as PrepaidCreditSummary | null,
  save: vi.fn(),
  balanceFetch: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock("@/components/page-header", () => ({ PageHeader: () => null }))
vi.mock("@/hooks/use-billing-context", () => ({
  useBillingContext: () => ({
    teamKey: "us:team",
    cacheScope: "self",
    ready: true,
  }),
}))
vi.mock("@/hooks/use-billing-summary", () => ({
  useBillingSummary: () => ({ data: { permissions: { can_manage: true } } }),
}))
vi.mock("@/hooks/use-prepaid-credit", () => ({
  usePrepaidCredit: () => ({ data: mocks.data, isLoading: false, error: null }),
}))
vi.mock("@/lib/api/client", () => ({
  apiClient: (...args: unknown[]) => mocks.balanceFetch(...args),
}))
vi.mock("@/lib/api/prepaid", async (original) => ({
  ...(await original<typeof import("@/lib/api/prepaid")>()),
  setPrepaidAutoRecharge: mocks.save,
}))
vi.mock("@superserve/ui", async (original) => ({
  ...(await original<typeof import("@superserve/ui")>()),
  useToast: () => ({ addToast: vi.fn() }),
}))

import { PlanAwareBanner } from "@/components/billing/plan-aware-banner"
import { usePrepaidBalance } from "@/hooks/use-billing-v2"
import type { TeamPlan } from "@/lib/api/billing-v2"
import { billingKeys } from "@/lib/api/query-keys"

import { BuyCreditPageClient } from "./page-client"

function BalanceBanner() {
  const prepaid = usePrepaidBalance(true)
  const plan: TeamPlan = {
    key: "starter",
    kind: "prepaid",
    name: "Starter",
    limits: {
      max_concurrent: 100,
      max_vcpu: 2,
      max_memory_mib: 4096,
      max_disk_mib: 51200,
      max_templates: null,
    },
    fee_cents: null,
    included_cents: null,
    period_start: null,
    period_end: null,
    pending_change: null,
  }
  return (
    <PlanAwareBanner plan={plan} prepaid={prepaid.data ?? null} canManage />
  )
}

const initial: PrepaidCreditSummary = {
  balance_cents: 2500,
  low_balance: false,
  has_saved_card: true,
  purchases: [],
  auto_recharge: {
    enabled: true,
    threshold_cents: 1000,
    amount_cents: 2500,
    disabled_reason: null,
    disabled_at: null,
    in_flight: false,
  },
}

describe("auto-recharge refresh", () => {
  it("refreshes the low-balance banner after auto-recharge is enabled", async () => {
    mocks.save.mockReset()
    mocks.data = {
      ...initial,
      balance_cents: 100,
      low_balance: true,
      auto_recharge: { ...initial.auto_recharge, enabled: false },
    }
    const updated = {
      ...mocks.data,
      auto_recharge: { ...mocks.data.auto_recharge, enabled: true },
    }
    mocks.save.mockResolvedValue(updated)
    mocks.balanceFetch.mockResolvedValue(updated)
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    client.setQueryData(
      billingKeys.v2("prepaid", { cacheScope: "self", teamKey: "us:team" }),
      mocks.data,
    )
    const view = render(
      <QueryClientProvider client={client}>
        <BuyCreditPageClient />
        <BalanceBanner />
      </QueryClientProvider>,
    )
    expect(
      screen.getByRole("link", { name: "Set up auto-recharge" }),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole("switch"))
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalled())
    await waitFor(() =>
      expect(
        screen.queryByRole("link", { name: "Set up auto-recharge" }),
      ).toBeNull(),
    )
    expect(mocks.balanceFetch).toHaveBeenCalledWith("/billing/prepaid")
    view.unmount()
    client.clear()
  })

  it("reflects a remote disable before saving again", async () => {
    mocks.data = initial
    const client = new QueryClient()
    const page = () => (
      <QueryClientProvider client={client}>
        <BuyCreditPageClient />
      </QueryClientProvider>
    )
    const { rerender } = render(page())
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true")
    mocks.data = {
      ...initial,
      auto_recharge: {
        ...initial.auto_recharge,
        enabled: false,
        disabled_reason: "card declined",
        disabled_at: "2026-10-23T00:00:00Z",
      },
    }
    mocks.save.mockResolvedValue(mocks.data)
    rerender(page())
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe(
      "false",
    )
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith("us:team", {
        enabled: false,
        thresholdCents: 1000,
        amountCents: 2500,
      }),
    )
  })
})

describe("auto-recharge rollback", () => {
  it("permits disabling while closing all new commitments", async () => {
    mocks.save.mockReset()
    mocks.data = initial
    const client = new QueryClient()
    render(
      <QueryClientProvider client={client}>
        <BuyCreditPageClient allowEntry={false} />
      </QueryClientProvider>,
    )
    expect(screen.queryByRole("button", { name: /Buy .* credit/ })).toBeNull()
    expect(screen.getByText("$25")).toBeTruthy()
    expect(screen.queryByText(/never expires/)).toBeNull()
    expect(screen.queryByText(/pause sandboxes at/)).toBeNull()
    for (const input of screen.getAllByRole("textbox"))
      expect(input.hasAttribute("disabled")).toBe(true)
    expect(
      screen.getByRole("button", { name: "Save" }).hasAttribute("disabled"),
    ).toBe(true)
    mocks.save.mockResolvedValue({
      ...initial,
      auto_recharge: { ...initial.auto_recharge, enabled: false },
    })
    fireEvent.click(screen.getByRole("switch"))
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe(
      "false",
    )
    fireEvent.click(screen.getByRole("switch"))
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe(
      "false",
    )
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith("us:team", {
        enabled: false,
        thresholdCents: 1000,
        amountCents: 2500,
      }),
    )
  })
})
