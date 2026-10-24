import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ api: vi.fn() }))
vi.mock("./use-billing-context", () => ({
  useBillingContext: () => ({
    cacheScope: "self",
    teamKey: "use:team-a",
    ready: true,
  }),
}))
vi.mock("@/lib/api/client", () => ({ apiClient: mocks.api }))

import {
  useFreeAllowance,
  usePrepaidBalance,
  useTeamPlan,
} from "./use-billing-v2"

beforeEach(() => mocks.api.mockReset())

describe("billing data after a failed refresh", () => {
  it.each([
    {
      name: "plan",
      hook: useTeamPlan,
      data: {
        key: "free",
        kind: "free",
        name: "Free",
        limits: {
          max_concurrent: 1,
          max_vcpu: 1,
          max_memory_mib: 1024,
          max_disk_mib: 4096,
          max_templates: null,
        },
        fee_cents: null,
        included_cents: null,
        period_start: "2026-10-01T00:00:00Z",
        period_end: "2026-11-01T00:00:00Z",
        pending_change: null,
      },
    },
    {
      name: "allowance",
      hook: useFreeAllowance,
      data: {
        applies: true,
        window_started_at: null,
        resets_at: null,
        allowance_cents: 13.32,
        used_cents: 0,
        remaining_cents: 13.32,
        paused: false,
        paused_reason: null,
        as_of: null,
      },
    },
    {
      name: "prepaid balance",
      hook: usePrepaidBalance,
      data: {
        balance_cents: 500,
        auto_recharge: {
          enabled: false,
          threshold_cents: null,
          amount_cents: null,
          disabled_reason: null,
          disabled_at: null,
          in_flight: false,
        },
      },
    },
  ])(
    "hides the retained $name and recovers on success",
    async ({ hook, data }) => {
      mocks.api.mockResolvedValue(
        hook === useTeamPlan
          ? {
              plan: {
                plan_key: "free",
                kind: "free",
                display_name: "Free",
                limits: (data as { limits: unknown }).limits,
                effective_from: "2026-10-23T00:00:00Z",
              },
              period: {
                start: "2026-10-01T00:00:00Z",
                end: "2026-11-01T00:00:00Z",
              },
              pending_change: null,
            }
          : data,
      )
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      })
      const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      )
      const { result, unmount } = renderHook(() => hook(true), { wrapper })
      await waitFor(() => expect(result.current.data).toEqual(data))
      mocks.api.mockRejectedValue(new Error("Billing unavailable"))
      await act(async () => {
        await result.current.refetch()
      })
      await waitFor(() => expect(result.current.isError).toBe(true))
      expect(client.getQueryCache().getAll()[0].state.data).toEqual(data)
      expect(result.current.data).toBeUndefined()
      mocks.api.mockResolvedValue(
        hook === useTeamPlan
          ? {
              plan: {
                plan_key: "free",
                kind: "free",
                display_name: "Free",
                limits: (data as { limits: unknown }).limits,
                effective_from: "2026-10-23T00:00:00Z",
              },
              period: {
                start: "2026-10-01T00:00:00Z",
                end: "2026-11-01T00:00:00Z",
              },
              pending_change: null,
            }
          : data,
      )
      await act(async () => {
        await result.current.refetch()
      })
      await waitFor(() => expect(result.current.data).toEqual(data))
      unmount()
      client.clear()
    },
  )
})
