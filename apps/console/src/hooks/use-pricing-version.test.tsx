import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "@/lib/api/client"

const mocks = vi.hoisted(() => ({ context: vi.fn(), api: vi.fn() }))
vi.mock("./use-billing-context", () => ({ useBillingContext: mocks.context }))
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  apiClient: mocks.api,
}))

import {
  useCatalogPlans,
  usePricingVersion,
  usePricingVersionState,
} from "./use-pricing-version"

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

  it("caches today's missing endpoint as a definite legacy answer", async () => {
    mocks.api.mockRejectedValue(new ApiError(404, "not_found", "Not found"))
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const { result } = renderHook(() => usePricingVersionState(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    })
    await waitFor(() => expect(result.current).toBe("legacy"))
    expect(
      client.getQueryState(["billing", "pricing-version", "self", "use:team-a"])
        ?.status,
    ).toBe("success")
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

  it("reports unknown until the catalog answers, without retrying failures", async () => {
    let resolve: (value: unknown) => void = () => {}
    mocks.api.mockReturnValue(new Promise((r) => (resolve = r)))
    const { result } = renderHook(() => usePricingVersionState(), { wrapper })
    expect(result.current).toBe("unknown")
    resolve({ plans: [] })
    await waitFor(() => expect(result.current).toBe("legacy"))
    mocks.api.mockReset().mockRejectedValue(new Error("Not found"))
    const failed = renderHook(() => usePricingVersionState(), {
      wrapper,
    })
    await waitFor(() => expect(failed.result.current).toBe("legacy"))
    expect(mocks.api).toHaveBeenCalledTimes(1)
  })

  it("keeps v2 when a later refresh answers 404", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    mocks.api.mockResolvedValue({ pricing_version: "v2" })
    const { result } = renderHook(() => usePricingVersion(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    })
    await waitFor(() => expect(result.current).toBe("v2"))
    mocks.api.mockRejectedValue(new ApiError(404, "not_found", "Not found"))
    await client.refetchQueries()
    expect(result.current).toBe("v2")
  })

  it("keeps v2 when a later refresh fails", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    mocks.api.mockResolvedValue({ pricing_version: "v2" })
    const { result } = renderHook(() => usePricingVersion(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    })
    await waitFor(() => expect(result.current).toBe("v2"))
    mocks.api.mockRejectedValue(new Error("down"))
    await client.refetchQueries()
    expect(result.current).toBe("v2")
  })

  it("shares one request with the plan catalog", async () => {
    mocks.api.mockResolvedValue({
      pricing_version: "v2",
      cards: [
        {
          family: "free",
          version: 1,
          price_label: "$0",
          tagline: "",
          features: [],
          display_only: false,
          monthly: null,
          annual: null,
          credit_summary: "",
          monthly_credit_cents: null,
          allowance: null,
          matching: null,
          kind: "free",
          name: "Free",
          fee_cents: 0,
          included_cents: null,
          limits: {
            max_concurrent: 1,
            max_vcpu: 1,
            max_memory_mib: 1024,
            max_disk_mib: 4096,
            max_templates: null,
          },
        },
      ],
    })
    const { result } = renderHook(
      () => ({ version: usePricingVersion(), catalog: useCatalogPlans() }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.catalog.data).toHaveLength(1))
    expect(result.current.version).toBe("v2")
    expect(mocks.api).toHaveBeenCalledTimes(1)
  })
})
