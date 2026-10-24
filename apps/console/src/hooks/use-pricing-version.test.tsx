import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@/hooks/use-billing-context", () => ({
  useBillingContext: () => ({
    teamKey: "us:team",
    cacheScope: "self",
    ready: true,
  }),
}))
vi.mock("@/lib/billing/plans-actions", () => ({
  getPublicBillingPlansAction: vi.fn(),
}))

import { getPublicBillingPlansAction } from "@/lib/billing/plans-actions"

import { usePricingVersion } from "./use-pricing-version"

afterEach(() => vi.useRealTimers())

describe("pricing version", () => {
  it("distinguishes exhausted loading failures from pending requests", async () => {
    vi.mocked(getPublicBillingPlansAction).mockRejectedValue(
      new Error("unavailable"),
    )
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => usePricingVersion(), { wrapper })
    expect(result.current).toBeUndefined()
    await waitFor(() => expect(result.current).toBeNull())
    expect(getPublicBillingPlansAction).toHaveBeenCalledWith("us")
  })
})

it("refreshes mounted entry state across rollback and fails closed on refresh errors", async () => {
  vi.useFakeTimers()
  vi.mocked(getPublicBillingPlansAction)
    .mockReset()
    .mockResolvedValueOnce({ pricing_version: "v2", cards: [] })
    .mockResolvedValueOnce({ pricing_version: "legacy", cards: [] })
    .mockResolvedValueOnce({ pricing_version: "v2", cards: [] })
    .mockRejectedValue(new Error("unavailable"))
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const { result, unmount } = renderHook(() => usePricingVersion(), { wrapper })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
  expect(result.current).toBe("v2")
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15_001)
  })
  expect(result.current).toBe("legacy")
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15_001)
  })
  expect(result.current).toBe("v2")
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15_001)
  })
  expect(result.current).toBeNull()
  expect(getPublicBillingPlansAction).toHaveBeenCalledTimes(4)
  expect(getPublicBillingPlansAction).toHaveBeenLastCalledWith("us")
  unmount()
  client.clear()
})
