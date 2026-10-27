import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { PrepaidCreditSummary, PrepaidPurchase } from "@/lib/api/prepaid"
import { billingKeys } from "@/lib/api/query-keys"
const state = vi.hoisted(() => ({
  team: "use:11111111-1111-4111-8111-111111111111",
  query: "",
  get: vi.fn(),
}))
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(state.query),
}))
vi.mock("@/components/query-provider", () => ({ useQueryScope: () => "self" }))
vi.mock("@/hooks/use-billing-context", () => ({
  useBillingContext: () => ({
    ready: true,
    teamKey: state.team,
    cacheScope: "self",
  }),
}))
vi.mock("@/hooks/use-user", () => ({
  useUser: () => ({ user: { id: "actor" } }),
}))
vi.mock("@/hooks/use-billing-summary", () => ({
  useBillingSummary: () => ({ data: { permissions: { can_manage: true } } }),
}))
vi.mock("@/hooks/use-teams", () => ({
  useTeams: () => ({ data: { teams: [] } }),
  useSwitchTeam: () => ({ mutateAsync: vi.fn() }),
}))
vi.mock("@/components/page-header", () => ({ PageHeader: () => null }))
vi.mock("@/lib/api/starter-checkout-recovery", () => ({
  recoverStarterCheckout: async () => ({
    outcome: "no_pending_starter_checkout",
  }),
}))
vi.mock("@superserve/ui", async (original) => ({
  ...(await original<typeof import("@superserve/ui")>()),
  useToast: () => ({ addToast: vi.fn() }),
}))
vi.mock("@/lib/api/prepaid", async (original) => ({
  ...(await original<typeof import("@/lib/api/prepaid")>()),
  getPrepaidCredit: () => state.get(),
}))
import { BuyCreditPageClient } from "./page-client"
const purchaseId = "33333333-3333-4333-8333-333333333333"
const team = "use:11111111-1111-4111-8111-111111111111"
const key = billingKeys.prepaid({ cacheScope: "self", teamKey: team })
function summary(
  status?: PrepaidPurchase["state"],
  id = purchaseId,
): PrepaidCreditSummary {
  return {
    checkout_idempotency_supported: true,
    balance_cents: 0,
    low_balance: true,
    has_saved_card: false,
    auto_recharge: {
      enabled: false,
      threshold_cents: null,
      amount_cents: null,
      disabled_reason: null,
      disabled_at: null,
      in_flight: false,
    },
    purchases: status
      ? [
          {
            id,
            source: "checkout",
            amount_cents: 500,
            state: status,
            failure_reason: null,
            paid_at: null,
            credited_at: null,
            created_at: "2026-10-27",
          },
        ]
      : [],
  }
}
function mount(
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <BuyCreditPageClient />
      </QueryClientProvider>,
    ),
  }
}
beforeEach(() => {
  state.team = team
  state.query = `purchase=success&team=${team}&purchase_id=${purchaseId}`
  state.get.mockReset().mockResolvedValue(summary())
  sessionStorage.clear()
})
describe("verified Starter return status with the real prepaid query", () => {
  it.each([
    ["credited", "Payment confirmed. Credit has been added."],
    ["paid", "Payment confirmed. Credit is being added."],
    ["failed", "This payment failed. Check recent purchases for details."],
  ] as const)(
    "converges pending to %s on an ordinary read without reload",
    async (status, notice) => {
      const { client } = mount()
      await screen.findByText(/Checking payment status/)
      state.get.mockResolvedValueOnce(summary(status))
      await act(async () => {
        await client.refetchQueries({ queryKey: key })
      })
      expect(screen.getByText(notice)).toBeTruthy()
      expect(screen.queryByText(/Checking payment status/)).toBeNull()
      // A credited purchase does not establish today's spendable balance.
      expect(screen.getByText("$0")).toBeTruthy()
      client.clear()
    },
  )
  it("never confirms this return using another credited purchase", async () => {
    state.get.mockResolvedValue(summary("credited", "different-purchase"))
    const { client } = mount()
    await screen.findByText(/Checking payment status/)
    expect(screen.queryByText(/Payment confirmed/)).toBeNull()
    client.clear()
  })
  it("hides cached claims after a failed read and retries GET only", async () => {
    state.get.mockResolvedValueOnce(summary("credited"))
    const { client } = mount()
    await screen.findByText("Payment confirmed. Credit has been added.")
    state.get.mockRejectedValueOnce(new Error("unavailable"))
    await act(async () => {
      await client.refetchQueries({ queryKey: key })
    })
    await waitFor(() =>
      expect(screen.queryByText(/Payment confirmed/)).toBeNull(),
    )
    expect(screen.getByRole("alert")).toHaveTextContent(
      "payment status are unavailable",
    )
    state.get.mockResolvedValueOnce(summary("credited"))
    fireEvent.click(screen.getByRole("button", { name: "Check status" }))
    await screen.findByText("Payment confirmed. Credit has been added.")
    expect(state.get).toHaveBeenCalledTimes(3)
    client.clear()
  })
  it("rejects a late response after switching away from the checkout team", async () => {
    let resolve!: (data: PrepaidCreditSummary) => void
    state.get.mockImplementationOnce(
      () =>
        new Promise<PrepaidCreditSummary>((done) => {
          resolve = done
        }),
    )
    const { client, rerender } = mount()
    await waitFor(() => expect(state.get).toHaveBeenCalledTimes(1))
    state.team = "usw:22222222-2222-4222-8222-222222222222"
    rerender(
      <QueryClientProvider client={client}>
        <BuyCreditPageClient />
      </QueryClientProvider>,
    )
    await act(async () => resolve(summary("credited")))
    expect(screen.queryByText(/Payment confirmed/)).toBeNull()
    expect(screen.queryByText("$0")).toBeNull()
    expect(state.get).toHaveBeenCalledTimes(1)
    client.clear()
  })
})
