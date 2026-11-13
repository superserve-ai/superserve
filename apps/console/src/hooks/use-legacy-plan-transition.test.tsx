import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { useLegacyPlanTransition } from "./use-legacy-plan-transition"

const mocks = vi.hoisted(() => ({
  capabilities: vi.fn(),
  context: vi.fn(),
  legacyEntry: vi.fn(),
}))
vi.mock("@/hooks/use-billing-capabilities", () => ({
  useBillingCapabilities: mocks.capabilities,
}))
vi.mock("@/hooks/use-billing-context", () => ({
  useBillingContext: mocks.context,
}))
vi.mock("@/lib/billing/plan-offers-actions", () => ({
  getLegacyPlanEntryAction: mocks.legacyEntry,
}))

function mount(enabled: boolean, client = new QueryClient()) {
  return {
    ...renderHook(() => useLegacyPlanTransition(enabled), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    }),
    client,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.capabilities.mockReturnValue({
    data: { admission_source: "all_teams" },
  })
  mocks.context.mockReturnValue({
    cacheScope: "self",
    teamKey: "usw:west-team",
    ready: true,
  })
  mocks.legacyEntry.mockResolvedValue(false)
})

describe("useLegacyPlanTransition", () => {
  it("uses capabilities without reading the durable flag", () => {
    mocks.capabilities.mockReturnValue({
      data: { admission_source: "legacy_transition" },
    })
    const { result } = mount(true)
    expect(result.current).toBe(true)
    expect(mocks.legacyEntry).not.toHaveBeenCalled()
  })

  it("uses the signup cache without reading the durable flag", () => {
    const client = new QueryClient()
    client.setQueryData(["signup-plan", "usw:west-team"], {
      legacyPlanEntry: true,
    })
    const { result } = mount(true, client)
    expect(result.current).toBe(true)
    expect(mocks.legacyEntry).not.toHaveBeenCalled()
  })

  it.each([true, false])(
    "reads the durable flag (%s) when enabled",
    async (migrated) => {
      mocks.legacyEntry.mockResolvedValue(migrated)
      const { result, client } = mount(true)
      await waitFor(() =>
        expect(
          client.getQueryData(["legacy-plan-entry", "self", "usw:west-team"]),
        ).toBe(migrated),
      )
      expect(result.current).toBe(migrated)
      expect(mocks.legacyEntry).toHaveBeenCalledExactlyOnceWith("usw:west-team")
    },
  )

  it("does not read the durable flag when disabled", () => {
    const { result } = mount(false)
    expect(result.current).toBe(false)
    expect(mocks.legacyEntry).not.toHaveBeenCalled()
  })

  it("recovers a migrated team from a stale signup cache after the global switch", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY } },
    })
    client.setQueryData(["signup-plan", "usw:west-team"], { state: "legacy" })
    mocks.legacyEntry.mockResolvedValue(true)
    const { result } = mount(true, client)
    await waitFor(() => expect(result.current).toBe(true))
    expect(mocks.legacyEntry).toHaveBeenCalledExactlyOnceWith("usw:west-team")
  })

  it.each([
    { teamKey: "usw:west-team", ready: false },
    { teamKey: null, ready: true },
  ])("waits for a ready team (%j)", (context) => {
    mocks.context.mockReturnValue({ cacheScope: "self", ...context })
    const { result } = mount(true)
    expect(result.current).toBe(false)
    expect(mocks.legacyEntry).not.toHaveBeenCalled()
  })
})
