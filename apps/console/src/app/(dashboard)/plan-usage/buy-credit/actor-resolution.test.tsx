import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  recover: vi.fn(),
  start: vi.fn(),
}))
vi.mock("@/lib/supabase/client", () => ({
  createBrowserClient: () => ({ auth: { getUser: mocks.getUser } }),
}))
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock("@/components/query-provider", () => ({ useQueryScope: () => "self" }))
vi.mock("@/components/page-header", () => ({ PageHeader: () => null }))
vi.mock("@/hooks/use-billing-context", () => ({
  useBillingContext: () => ({
    ready: true,
    teamKey: "use:11111111-1111-4111-8111-111111111111",
    cacheScope: "self",
  }),
}))
vi.mock("@/hooks/use-billing-summary", () => ({
  useBillingSummary: () => ({ data: { permissions: { can_manage: true } } }),
}))
vi.mock("@/hooks/use-prepaid-credit", () => ({
  usePrepaidCredit: () => ({
    data: {
      checkout_idempotency_supported: true,
      balance_cents: 0,
      purchases: [],
      has_saved_card: false,
      auto_recharge: { enabled: false },
    },
  }),
  useRetainedPrepaidOperations: () => [],
}))
vi.mock("@/lib/api/starter-checkout-recovery", () => ({
  recoverStarterCheckout: (...args: unknown[]) => mocks.recover(...args),
}))
vi.mock("@/lib/api/prepaid", async (original) => ({
  ...(await original<typeof import("@/lib/api/prepaid")>()),
  startPrepaidCheckout: (...args: unknown[]) => mocks.start(...args),
}))
vi.mock("@superserve/ui", async (original) => ({
  ...(await original<typeof import("@superserve/ui")>()),
  useToast: () => ({ addToast: vi.fn() }),
}))

import { BuyCreditPageClient } from "./page-client"

beforeEach(() => {
  mocks.getUser.mockReset()
  mocks.recover
    .mockReset()
    .mockResolvedValue({ outcome: "no_pending_starter_checkout" })
  mocks.start.mockReset().mockResolvedValue({
    state: "pending",
    purchase_id: "33333333-3333-4333-8333-333333333333",
  })
})

it.each(["pending", "failed"])(
  "does not create credit when the parent's actual auth request is %s but a later independent request would resolve",
  async (outcome) => {
    let settle!: (value: unknown) => void
    mocks.getUser
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            settle = resolve
          }),
      )
      .mockResolvedValue({
        data: { user: { id: "child-resolved-actor" } },
        error: null,
      })
    render(
      <QueryClientProvider client={new QueryClient()}>
        <BuyCreditPageClient />
      </QueryClientProvider>,
    )
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    const buy = screen.getByRole("button", { name: "Buy $25 credit" })
    expect(buy).toBeDisabled()
    fireEvent.click(buy)
    expect(mocks.start).not.toHaveBeenCalled()
    expect(mocks.recover).not.toHaveBeenCalled()
    if (outcome === "failed") {
      await act(async () =>
        settle({ data: { user: null }, error: new Error("auth unavailable") }),
      )
      await screen.findByText(/Unable to verify your account/)
      expect(buy).toBeDisabled()
      fireEvent.click(buy)
      expect(mocks.start).not.toHaveBeenCalled()
      expect(mocks.recover).not.toHaveBeenCalled()
    } else {
      await act(async () =>
        settle({
          data: { user: { id: "original-parent-actor" } },
          error: null,
        }),
      )
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: "Buy $25 credit" }),
        ).not.toBeDisabled(),
      )
      expect(mocks.recover).toHaveBeenCalledExactlyOnceWith(
        "use:11111111-1111-4111-8111-111111111111",
      )
      fireEvent.click(screen.getByRole("button", { name: "Buy $25 credit" }))
      await waitFor(() => expect(mocks.start).toHaveBeenCalledOnce())
      expect(mocks.start.mock.calls[0]![3]).toBe("original-parent-actor")
    }
  },
)
