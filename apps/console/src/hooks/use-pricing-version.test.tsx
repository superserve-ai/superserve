import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/hooks/use-billing-context", () => ({
  useBillingContext: () => ({
    teamKey: "us:team",
    cacheScope: "self",
    ready: true,
  }),
}))
vi.mock("@/lib/api/client", () => ({ apiClient: vi.fn() }))

import { apiClient } from "@/lib/api/client"

import { usePricingVersion } from "./use-pricing-version"

describe("pricing version", () => {
  it("distinguishes exhausted loading failures from pending requests", async () => {
    vi.mocked(apiClient).mockRejectedValue(new Error("unavailable"))
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => usePricingVersion(), { wrapper })
    expect(result.current).toBeUndefined()
    await waitFor(() => expect(result.current).toBeNull())
  })
})
