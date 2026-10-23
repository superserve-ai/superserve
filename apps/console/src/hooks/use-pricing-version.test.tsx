import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ context: vi.fn(), api: vi.fn() }))
vi.mock("./use-billing-context", () => ({ useBillingContext: mocks.context }))
vi.mock("@/lib/api/client", () => ({ apiClient: mocks.api }))

import { usePricingVersion } from "./use-pricing-version"

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {children}
    </QueryClientProvider>
  )
}

beforeEach(() => {
  mocks.api.mockReset()
  mocks.context.mockReturnValue({
    cacheScope: "self",
    teamKey: "use:team-a",
    ready: true,
  })
})

describe("usePricingVersion", () => {
  it("is legacy against today's backend, which has no pricing version", async () => {
    mocks.api.mockResolvedValue({ plans: [] })
    const { result } = renderHook(() => usePricingVersion(), { wrapper })
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1))
    expect(mocks.api).toHaveBeenCalledWith("/billing/plans/public")
    expect(result.current).toBe("legacy")
  })

  it("is legacy when the catalog request fails", async () => {
    mocks.api.mockRejectedValue(new Error("Not found"))
    const { result } = renderHook(() => usePricingVersion(), { wrapper })
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1))
    expect(result.current).toBe("legacy")
  })

  it("turns on once the region reports v2", async () => {
    mocks.api.mockResolvedValue({ pricing_version: "v2", plans: [] })
    const { result } = renderHook(() => usePricingVersion(), { wrapper })
    await waitFor(() => expect(result.current).toBe("v2"))
  })

  it("waits for the active team before asking", () => {
    mocks.context.mockReturnValue({
      cacheScope: "self",
      teamKey: null,
      ready: true,
    })
    const { result } = renderHook(() => usePricingVersion(), { wrapper })
    expect(result.current).toBe("legacy")
    expect(mocks.api).not.toHaveBeenCalled()
  })
})
