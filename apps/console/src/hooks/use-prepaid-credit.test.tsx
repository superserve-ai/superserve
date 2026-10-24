import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, expect, it, vi } from "vitest"

vi.mock("@/hooks/use-billing-context", () => ({
  useBillingContext: () => ({
    teamKey: "use:example-team",
    cacheScope: "self",
    ready: true,
  }),
}))
vi.mock("@/lib/api/prepaid", () => ({ getPrepaidCredit: vi.fn() }))

import { getPrepaidCredit, type PrepaidCreditSummary } from "@/lib/api/prepaid"

import { usePrepaidCredit } from "./use-prepaid-credit"

afterEach(() => vi.useRealTimers())

it("polls paid purchases until their credit and balance are applied", async () => {
  vi.useFakeTimers()
  const summary = (
    state: "pending" | "paid" | "credited",
  ): PrepaidCreditSummary => ({
    balance_cents: state === "credited" ? 500 : 0,
    low_balance: state !== "credited",
    has_saved_card: true,
    auto_recharge: {
      enabled: false,
      threshold_cents: null,
      amount_cents: null,
      disabled_reason: null,
      disabled_at: null,
      in_flight: false,
    },
    purchases: [
      {
        id: "example-purchase",
        source: "checkout",
        amount_cents: 500,
        state,
        failure_reason: null,
        paid_at: null,
        credited_at: null,
        created_at: "2026-01-01T00:00:00Z",
      },
    ],
  })
  vi.mocked(getPrepaidCredit)
    .mockResolvedValueOnce(summary("pending"))
    .mockResolvedValueOnce(summary("paid"))
    .mockResolvedValue(summary("credited"))
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const { result, unmount } = renderHook(() => usePrepaidCredit(), { wrapper })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
  expect(result.current.data?.purchases[0]?.state).toBe("pending")
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5_001)
  })
  expect(result.current.data?.purchases[0]?.state).toBe("paid")
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5_001)
  })
  expect(result.current.data?.purchases[0]?.state).toBe("credited")
  expect(result.current.data?.balance_cents).toBe(500)
  expect(getPrepaidCredit).toHaveBeenCalledTimes(3)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5_001)
  })
  expect(getPrepaidCredit).toHaveBeenCalledTimes(3)
  unmount()
  client.clear()
})
