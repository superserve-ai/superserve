import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { TrialBillingBanner } from "@/components/trial-billing-banner"
import type { BillingSummaryResponse } from "@/lib/api/billing"

import { useBillingSummary } from "./use-billing-summary"

const useBillingContext = vi.fn()
const getBillingSummary = vi.fn()

vi.mock("@/hooks/use-billing-context", () => ({
  useBillingContext: () => useBillingContext(),
}))

vi.mock("@/lib/api/billing", () => ({
  getBillingSummary: (...args: unknown[]) => getBillingSummary(...args),
}))

vi.mock("next/navigation", () => ({ usePathname: () => "/sandboxes/" }))
vi.mock("@superserve/ui", async () => ({
  ...(await vi.importActual<typeof import("@superserve/ui")>("@superserve/ui")),
  useToast: () => ({ addToast: vi.fn() }),
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

const baseBillingSummary: BillingSummaryResponse = {
  billing_mode: "live",
  checkout_available: true,
  portal_available: true,
  payment_setup_required: false,
  permissions: {
    can_view: true,
    can_manage: true,
  },
  current_charges_usd: 10,
  credits_applied_usd: 0,
  credits_remaining_usd: 0,
  expected_invoice_amount_usd: 10,
  cost_breakdown_usd: {
    compute: 6,
    memory: 3,
    storage: 1,
  },
  resources: [
    {
      resource_key: "vcpu",
      resource: "cpu",
      display_name: "CPU",
      sort_order: 10,
      unit: "second",
      display_unit: "vCPU-hours",
      usage: 120,
      tracked: true,
      billable: true,
      charge_usd: 6,
    },
    {
      resource_key: "memory_gib",
      resource: "memory",
      display_name: "Memory",
      sort_order: 20,
      unit: "second",
      display_unit: "GiB-hours",
      usage: 2_048_000,
      tracked: true,
      billable: true,
      charge_usd: 3,
    },
    {
      resource_key: "storage_gib",
      resource: "storage",
      display_name: "Storage",
      sort_order: 30,
      unit: "second",
      display_unit: "GiB-hours",
      usage: 4_096_000,
      tracked: true,
      billable: false,
      charge_usd: 1,
    },
  ],
  billing_period: {
    start: "2026-06-01T00:00:00.000Z",
    end: "2026-07-01T00:00:00.000Z",
  },
  pricing_tier: {
    plan_key: "payg",
    plan_name: "Pay-as-you-go",
    currency: "USD",
  },
  calculated_at: "2026-06-16T00:00:00.000Z",
}

function BillingSummaryValue() {
  const { data, isPending } = useBillingSummary()

  return (
    <div>
      {isPending || !data
        ? "loading"
        : formatCurrency(data.current_charges_usd)}
    </div>
  )
}

describe("useBillingSummary", () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })
    useBillingContext.mockReset()
    getBillingSummary.mockReset()
  })

  afterEach(() => {
    queryClient.clear()
  })

  it.each([
    {
      label: "read-only exhausted trial",
      permissions: { can_view: true, can_manage: false },
      state: "exhausted",
      visible: true,
    },
    {
      label: "billing access denied",
      permissions: { can_view: false, can_manage: false },
      state: "active",
      visible: false,
    },
    {
      label: "activated billing",
      permissions: { can_view: true, can_manage: false },
      state: "ended_by_billing_activation",
      visible: false,
    },
  ])(
    "isolates the real banner when switching to Team B with $label, including a late Team A response",
    async ({ permissions, state, visible }) => {
      const teamA: BillingSummaryResponse = {
        ...baseBillingSummary,
        trial: {
          state: "active",
          remaining_usd: 3.25,
          runway_state: "over_24h",
        },
      }
      const teamB: BillingSummaryResponse = {
        ...baseBillingSummary,
        permissions,
        trial: { state, remaining_usd: 0 },
      }
      const lateTeamA = deferred<BillingSummaryResponse>()
      const pendingTeamB = deferred<BillingSummaryResponse>()
      useBillingContext.mockReturnValue({
        cacheScope: "self",
        teamKey: "use:team-a",
        ready: true,
      })
      getBillingSummary
        .mockResolvedValueOnce(teamA)
        .mockImplementationOnce(() => lateTeamA.promise)
        .mockImplementationOnce(() => pendingTeamB.promise)
      const view = () => (
        <QueryClientProvider client={queryClient}>
          <TrialBillingBanner />
        </QueryClientProvider>
      )
      const { rerender } = render(view())
      expect(await screen.findByText("$3.25 remaining")).toBeInTheDocument()
      expect(screen.getByRole("button", { name: "Add Payment" })).toBeEnabled()

      // Leave a refresh in flight after Team A has already displayed its banner.
      act(() => {
        void queryClient.invalidateQueries({
          queryKey: ["billing", "summary", "self", "use:team-a"],
        })
      })
      await waitFor(() => expect(getBillingSummary).toHaveBeenCalledTimes(2))
      useBillingContext.mockReturnValue({
        cacheScope: "self",
        teamKey: "use:team-b",
        ready: true,
      })
      rerender(view())

      // Assert synchronously: waiting for disappearance could miss a stale flash.
      expect(screen.queryByRole("status")).not.toBeInTheDocument()
      expect(screen.queryByRole("button")).not.toBeInTheDocument()
      expect(screen.queryByText("$3.25 remaining")).not.toBeInTheDocument()
      await waitFor(() => expect(getBillingSummary).toHaveBeenCalledTimes(3))

      await act(async () => pendingTeamB.resolve(teamB))
      const expectTeamB = () => {
        if (visible) {
          expect(screen.getByRole("status")).toHaveClass("bg-red-100")
          expect(screen.getByRole("status")).toHaveTextContent(
            "Your free trial credit has run out.",
          )
          expect(
            screen.getByText("Contact your team's billing administrator."),
          ).toBeInTheDocument()
        } else {
          expect(screen.queryByRole("status")).not.toBeInTheDocument()
        }
        expect(screen.queryByRole("button")).not.toBeInTheDocument()
        expect(screen.queryByText("$3.25 remaining")).not.toBeInTheDocument()
      }
      await waitFor(() => {
        expect(
          queryClient.getQueryData([
            "billing",
            "summary",
            "self",
            "use:team-b",
          ]),
        ).toEqual(teamB)
        expectTeamB()
      })

      const lateSummary: BillingSummaryResponse = {
        ...teamA,
        trial: {
          state: "active",
          remaining_usd: 1.75,
          runway_state: "over_24h",
        },
      }
      await act(async () => lateTeamA.resolve(lateSummary))
      await waitFor(() =>
        expect(
          queryClient.getQueryData([
            "billing",
            "summary",
            "self",
            "use:team-a",
          ]),
        ).toEqual(lateSummary),
      )
      expectTeamB()
      expect(screen.queryByText("$1.75 remaining")).not.toBeInTheDocument()
    },
  )

  it("drops Team A data immediately when switching to Team B and caches each team separately", async () => {
    const teamA = {
      ...baseBillingSummary,
    } satisfies BillingSummaryResponse
    const teamB = {
      ...teamA,
      current_charges_usd: 25,
      expected_invoice_amount_usd: 25,
      cost_breakdown_usd: {
        compute: 15,
        memory: 7,
        storage: 3,
      },
      resources: [
        {
          resource_key: "vcpu",
          resource: "cpu",
          display_name: "CPU",
          sort_order: 10,
          unit: "second",
          display_unit: "vCPU-hours",
          usage: 300,
          tracked: true,
          billable: true,
          charge_usd: 15,
        },
        {
          resource_key: "memory_gib",
          resource: "memory",
          display_name: "Memory",
          sort_order: 20,
          unit: "second",
          display_unit: "GiB-hours",
          usage: 4_096_000,
          tracked: true,
          billable: true,
          charge_usd: 7,
        },
        {
          resource_key: "storage_gib",
          resource: "storage",
          display_name: "Storage",
          sort_order: 30,
          unit: "second",
          display_unit: "GiB-hours",
          usage: 8_192_000,
          tracked: true,
          billable: false,
          charge_usd: 3,
        },
      ],
    } satisfies BillingSummaryResponse

    const first = deferred<BillingSummaryResponse>()
    const second = deferred<BillingSummaryResponse>()

    useBillingContext.mockReturnValue({
      cacheScope: "self",
      teamKey: "use:team-a",
      ready: true,
    })
    getBillingSummary.mockImplementationOnce(() => first.promise)
    getBillingSummary.mockImplementationOnce(() => second.promise)

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <BillingSummaryValue />
      </QueryClientProvider>,
    )

    await waitFor(() => expect(getBillingSummary).toHaveBeenCalledTimes(1))

    first.resolve(teamA)
    expect(await screen.findByText("$10.00")).toBeInTheDocument()

    useBillingContext.mockReturnValue({
      cacheScope: "self",
      teamKey: "use:team-b",
      ready: true,
    })
    rerender(
      <QueryClientProvider client={queryClient}>
        <BillingSummaryValue />
      </QueryClientProvider>,
    )

    await waitFor(() =>
      expect(screen.queryByText("$10.00")).not.toBeInTheDocument(),
    )
    expect(screen.getByText("loading")).toBeInTheDocument()

    second.resolve(teamB)
    expect(await screen.findByText("$25.00")).toBeInTheDocument()

    expect(
      queryClient
        .getQueryCache()
        .getAll()
        .map((query) => query.queryKey),
    ).toEqual(
      expect.arrayContaining([
        ["billing", "summary", "self", "use:team-a"],
        ["billing", "summary", "self", "use:team-b"],
      ]),
    )
  })
  it("does not let a delayed old-scope response replace the current scope", async () => {
    const oldRequest = deferred<BillingSummaryResponse>()
    const newRequest = deferred<BillingSummaryResponse>()
    useBillingContext.mockReturnValue({
      cacheScope: "self",
      teamKey: "use:a",
      ready: true,
    })
    getBillingSummary.mockImplementationOnce(() => oldRequest.promise)
    getBillingSummary.mockImplementationOnce(() => newRequest.promise)
    const view = () => (
      <QueryClientProvider client={queryClient}>
        <BillingSummaryValue />
      </QueryClientProvider>
    )
    const { rerender } = render(view())
    await waitFor(() => expect(getBillingSummary).toHaveBeenCalledTimes(1))
    useBillingContext.mockReturnValue({
      cacheScope: "impersonated",
      teamKey: "usw:b",
      ready: true,
    })
    rerender(view())
    await waitFor(() => expect(getBillingSummary).toHaveBeenCalledTimes(2))
    newRequest.resolve({ ...baseBillingSummary, current_charges_usd: 25 })
    expect(await screen.findByText("$25.00")).toBeInTheDocument()
    oldRequest.resolve(baseBillingSummary)
    await waitFor(() =>
      expect(
        queryClient.getQueryData(["billing", "summary", "self", "use:a"]),
      ).toBeDefined(),
    )
    expect(screen.queryByText("$10.00")).not.toBeInTheDocument()
    expect(screen.getByText("$25.00")).toBeInTheDocument()
  })

  it("waits until team cookie switching completes before fetching the new scope", async () => {
    useBillingContext.mockReturnValue({
      cacheScope: "self",
      teamKey: "use:b",
      ready: false,
    })
    getBillingSummary.mockResolvedValue(baseBillingSummary)
    const view = () => (
      <QueryClientProvider client={queryClient}>
        <BillingSummaryValue />
      </QueryClientProvider>
    )
    const { rerender } = render(view())
    expect(getBillingSummary).not.toHaveBeenCalled()
    useBillingContext.mockReturnValue({
      cacheScope: "self",
      teamKey: "use:b",
      ready: true,
    })
    rerender(view())
    expect(await screen.findByText("$10.00")).toBeInTheDocument()
  })
  it("refreshes the shared summary every 60 seconds in the foreground", async () => {
    vi.useFakeTimers()
    try {
      useBillingContext.mockReturnValue({
        cacheScope: "self",
        teamKey: "use:a",
        ready: true,
      })
      getBillingSummary.mockResolvedValue(baseBillingSummary)
      render(
        <QueryClientProvider client={queryClient}>
          <BillingSummaryValue />
          <BillingSummaryValue />
        </QueryClientProvider>,
      )
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1)
      })
      expect(getBillingSummary).toHaveBeenCalledTimes(1)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000)
      })
      expect(getBillingSummary).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
