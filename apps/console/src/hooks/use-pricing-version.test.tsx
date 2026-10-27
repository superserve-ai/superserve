import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  team: "use:11111111-1111-4111-8111-111111111111",
  actor: "actor-a",
  ready: true,
  get: vi.fn(),
}))
vi.mock("@/hooks/use-billing-context", () => ({
  useBillingContext: () => ({
    teamKey: state.team,
    cacheScope: "self",
    ready: state.ready,
  }),
}))
vi.mock("@/hooks/use-user", () => ({
  useUser: () => ({ user: { id: state.actor } }),
}))
vi.mock("@/lib/api/billing-capabilities", () => ({
  getBillingCapabilities: (...args: unknown[]) => state.get(...args),
}))

import { useBillingCapabilities } from "./use-billing-capabilities"
import {
  usePricingVersion,
  usePricingVersionState,
} from "./use-pricing-version"

afterEach(() => {
  vi.useRealTimers()
  state.team = "use:11111111-1111-4111-8111-111111111111"
  state.actor = "actor-a"
  state.ready = true
  state.get.mockReset()
})
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return {
    client,
    ...renderHook(
      () => ({
        version: usePricingVersion(),
        model: usePricingVersionState(),
        capabilities: useBillingCapabilities(),
      }),
      { wrapper },
    ),
  }
}
it("holds missing capability failures as unknown, never legacy", async () => {
  state.get.mockRejectedValue(new Error("404"))
  const { result } = setup()
  expect(result.current.version).toBeUndefined()
  await waitFor(() => expect(result.current.version).toBeNull())
  expect(result.current.model).toBe("unknown")
})
it("keeps enrolled model on gate close, then revokes cached entry on refresh failure", async () => {
  vi.useFakeTimers()
  state.get
    .mockResolvedValueOnce({ pricing_version: "v2", entry_open: true })
    .mockResolvedValueOnce({ pricing_version: "v2", entry_open: false })
    .mockRejectedValue(new Error("unavailable"))
  const { result, unmount, client } = setup()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
  expect(result.current.capabilities.data?.entry_open).toBe(true)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15001)
  })
  expect(result.current.version).toBe("v2")
  expect(result.current.capabilities.data?.entry_open).toBe(false)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15001)
  })
  expect(result.current.model).toBe("unknown")
  expect(result.current.capabilities.data).toBeUndefined()
  unmount()
  client.clear()
})
it("partitions team and actor, and hides previous permissions during switching", async () => {
  state.get.mockResolvedValue({ pricing_version: "v2", entry_open: true })
  const { result, rerender } = setup()
  await waitFor(() => expect(result.current.version).toBe("v2"))
  state.ready = false
  rerender()
  expect(result.current.capabilities.data).toBeUndefined()
  state.team = "usw:22222222-2222-4222-8222-222222222222"
  state.ready = true
  state.get.mockRejectedValue(new Error("unavailable"))
  rerender()
  expect(result.current.capabilities.data).toBeUndefined()
  await waitFor(() => expect(result.current.model).toBe("unknown"))
  expect(state.get).toHaveBeenLastCalledWith(state.team)
  state.actor = "actor-b"
  rerender()
  expect(result.current.capabilities.data).toBeUndefined()
})
