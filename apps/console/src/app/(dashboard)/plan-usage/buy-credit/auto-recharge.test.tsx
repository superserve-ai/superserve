import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { PrepaidCreditSummary } from "@/lib/api/prepaid"

const mocks = vi.hoisted(() => ({
  data: null as PrepaidCreditSummary | null,
  save: vi.fn(),
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
vi.mock("@/lib/api/prepaid", async (original) => ({
  ...(await original<typeof import("@/lib/api/prepaid")>()),
  setPrepaidAutoRecharge: mocks.save,
}))
vi.mock("@superserve/ui", async (original) => ({
  ...(await original<typeof import("@superserve/ui")>()),
  useToast: () => ({ addToast: vi.fn() }),
}))

import { BuyCreditPageClient } from "./page-client"

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
