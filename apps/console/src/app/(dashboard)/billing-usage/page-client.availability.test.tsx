import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { BillingSummaryResponse } from "@/lib/api/billing"
import { ApiError } from "@/lib/api/client"
import { billingKeys } from "@/lib/api/query-keys"

const mocks = vi.hoisted(() => ({
  summary: vi.fn(),
  usage: vi.fn(),
  capabilities: vi.fn(),
  actor: "user",
  team: "team-a",
  scope: "self",
  manage: true,
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/billing-usage/",
}))
vi.mock("@/hooks/use-user", () => ({
  useUser: () => ({ user: { id: mocks.actor }, loading: false }),
}))
vi.mock("@/hooks/use-teams", () => ({
  useTeams: () => ({
    data: { teams: [], activeTeamId: mocks.team, activeRegion: "use" },
  }),
}))
vi.mock("@/components/query-provider", () => ({
  useQueryScope: () => mocks.scope,
  useDashboardTeamContext: () => ({
    teamId: mocks.team,
    region: "use",
    name: "Example team",
  }),
}))
vi.mock("@/lib/api/billing-capabilities", async (original) => ({
  ...(await original<typeof import("@/lib/api/billing-capabilities")>()),
  getBillingCapabilities: () => mocks.capabilities(),
}))
vi.mock("@/hooks/use-billing-v2", () => ({
  useTeamEntry: () => ({ data: null, isPending: false, isError: false }),
  useTeamPlan: () => ({
    data: {
      key: "pro",
      kind: "subscription",
      name: `Plan ${mocks.team}`,
      limits: {
        max_concurrent: 10,
        max_vcpu: 4,
        max_memory_mib: 8192,
        max_disk_mib: 10240,
        max_templates: null,
      },
      fee_cents: null,
      included_cents: null,
      period_start: null,
      period_end: null,
      effective_from: "2026-01-01T00:00:00Z",
      pending_change: null,
    },
    isError: false,
  }),
  useFreeAllowance: () => ({ data: undefined }),
  useAllowancePricing: () => ({ data: undefined }),
  usePrepaidBalance: () => ({ data: undefined }),
}))
vi.mock("@/hooks/use-legacy-plan-transition", () => ({
  useLegacyPlanTransition: () => false,
}))
vi.mock("@/hooks/use-customer-billing", () => ({
  useCustomerBillingPeriods: () => ({
    data: { periods: [] },
    isPending: false,
    isFetching: false,
  }),
}))
vi.mock("@/lib/api/billing", () => ({
  getBillingSummary: () => mocks.summary(),
  getBillingUsageSeries: () => mocks.usage(),
}))
vi.mock("@/lib/api/billing-actions", () => ({ getBillingUsageAction: vi.fn() }))
vi.mock("@superserve/ui", async (original) => ({
  ...(await original<typeof import("@superserve/ui")>()),
  useToast: () => ({ addToast: vi.fn() }),
}))
vi.mock("@/components/date-range-filter", () => ({
  DateRangeFilter: () => <div>Date range</div>,
}))

import { PlanUsagePageClient } from "./page-client"

const knownSummary = (): BillingSummaryResponse => ({
  calculated_at: "2026-11-20T00:00:00Z",
  pricing_tier: { plan_name: "Standard", currency: "USD", plan_key: "pro" },
  billing_mode: "live",
  checkout_available: true,
  portal_available: true,
  payment_setup_required: false,
  permissions: { can_view: true, can_manage: mocks.manage },
  current_charges_usd: 12,
  credits_applied_usd: 0,
  credits_remaining_usd: null,
  expected_invoice_amount_usd: null,
  cost_breakdown_usd: { compute: 8, memory: 4, storage: 0 },
  resources: [],
  billing_period: {
    start: "2026-11-01T00:00:00Z",
    end: "2026-12-01T00:00:00Z",
  },
})
const account = {
  billing_mode: "live" as const,
  permissions: { can_view: true, can_manage: true },
  checkout_available: false,
  portal_available: true,
  subscription_status: "active",
  trial_ended: false,
}
function capabilities() {
  return {
    pricing_version: "legacy",
    fresh_entry: {
      pro: false,
      starter: false,
      choose_free: false,
      auto_recharge: false,
    },
  }
}
const unavailable = () =>
  new ApiError(503, "storage_unavailable", "Storage unavailable")
let client: QueryClient
function page() {
  return (
    <QueryClientProvider client={client}>
      <PlanUsagePageClient />
    </QueryClientProvider>
  )
}
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retryDelay: 1 } } })
  mocks.actor = "user"
  mocks.capabilities.mockReset().mockResolvedValue(capabilities())
  mocks.team = "team-a"
  mocks.scope = "self"
  mocks.manage = true
  mocks.summary.mockReset().mockRejectedValue(unavailable())
  mocks.usage.mockReset().mockRejectedValue(unavailable())
})
afterEach(() => client.clear())

describe("billing page availability", () => {
  it("shows the known plan during loading and settles explicit storage failures without retries", async () => {
    let fail!: (reason: Error) => void
    mocks.summary.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          fail = reject
        }),
    )
    render(page())
    expect(screen.getAllByText("Plan team-a")[0]).toBeInTheDocument()
    await act(async () => fail(unavailable()))
    expect(
      await screen.findAllByRole("region", { name: "Usage unavailable" }),
    ).toHaveLength(2)
    expect(mocks.summary).toHaveBeenCalledTimes(1)
    expect(mocks.usage).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId("billing-statement")).not.toBeInTheDocument()
    expect(screen.queryByTestId("usage-cost-chart")).not.toBeInTheDocument()
    expect(
      screen.queryByText("No Usage For This Period"),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Open Customer Portal" }),
    ).not.toBeInTheDocument()
  })

  it("recovers on manual retry with normal plan, summary and permitted payment controls", async () => {
    render(page())
    await screen.findAllByRole("region", { name: "Usage unavailable" })
    mocks.summary.mockResolvedValue(knownSummary())
    fireEvent.click(screen.getAllByRole("button", { name: "Retry usage" })[0])
    expect(await screen.findByTestId("billing-statement")).toBeInTheDocument()
    expect(screen.getByText("$12.00")).toBeInTheDocument()
    expect(
      await screen.findByRole("button", { name: "Open Customer Portal" }),
    ).toBeEnabled()
  })

  it("invalidates retained summary claims and actions after a failed refresh", async () => {
    mocks.summary.mockResolvedValueOnce(knownSummary())
    render(page())
    await screen.findByTestId("billing-statement")
    await act(async () => {
      await client.invalidateQueries({
        queryKey: billingKeys.summary({
          cacheScope: "self",
          teamKey: "use:team-a",
        }),
      })
    })
    await waitFor(() =>
      expect(screen.queryByTestId("billing-statement")).not.toBeInTheDocument(),
    )
    expect(screen.queryByText("$12.00")).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Open Customer Portal" }),
    ).not.toBeInTheDocument()
    expect(screen.getAllByText("Plan team-a")[0]).toBeInTheDocument()
  })

  it("does not carry the previous team's claims into a failed scoped view", async () => {
    mocks.summary.mockResolvedValueOnce(knownSummary())
    const view = render(page())
    await screen.findByTestId("billing-statement")
    mocks.team = "team-b"
    mocks.scope = "team-b"
    view.rerender(page())
    expect(screen.getAllByText("Plan team-b")[0]).toBeInTheDocument()
    await screen.findAllByRole("region", { name: "Usage unavailable" })
    expect(screen.queryByText("$12.00")).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Open Customer Portal" }),
    ).not.toBeInTheDocument()
  })

  it("keeps successful billing view-only when management permission is absent", async () => {
    mocks.manage = false
    mocks.summary.mockResolvedValue(knownSummary())
    render(page())
    await screen.findByTestId("billing-statement")
    expect(
      screen.getByText("Billing is view-only for your role."),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Open Customer Portal" }),
    ).not.toBeInTheDocument()
  })
})

describe("independent account authority", () => {
  it("offers an authorized portal during usage failure without inventing a financial summary", async () => {
    mocks.capabilities.mockResolvedValue({ ...capabilities(), account })
    render(page())
    expect(
      await screen.findByRole("button", { name: "Open Customer Portal" }),
    ).toBeEnabled()
    expect(screen.queryByTestId("billing-statement")).not.toBeInTheDocument()
    expect(screen.queryByText(/\$0|\$12/)).not.toBeInTheDocument()
  })

  it.each([
    null,
    { ...account, permissions: { can_view: true, can_manage: false } },
    { ...account, portal_available: false },
  ])(
    "withholds actions when current account metadata denies or cannot establish them",
    async (account) => {
      mocks.summary.mockResolvedValue(knownSummary())
      mocks.capabilities.mockResolvedValue({ ...capabilities(), account })
      render(page())
      await screen.findByTestId("billing-statement")
      await waitFor(() => expect(mocks.capabilities).toHaveBeenCalled())
      expect(
        screen.queryByRole("button", { name: "Open Customer Portal" }),
      ).not.toBeInTheDocument()
    },
  )

  it("revokes fallback actions after a failed metadata refresh", async () => {
    mocks.capabilities
      .mockResolvedValueOnce({ ...capabilities(), account })
      .mockRejectedValue(new Error("Metadata unavailable"))
    render(page())
    await screen.findByRole("button", { name: "Open Customer Portal" })
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["billing", "capabilities"] })
    })
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Open Customer Portal" }),
      ).not.toBeInTheDocument(),
    )
  })

  it("waits for the new actor's permissions even with a cached successful summary", async () => {
    mocks.summary.mockResolvedValue(knownSummary())
    const view = render(page())
    await screen.findByRole("button", { name: "Open Customer Portal" })
    mocks.actor = "another-user"
    mocks.capabilities.mockImplementation(() => new Promise(() => {}))
    view.rerender(page())
    expect(
      screen.queryByRole("button", { name: "Open Customer Portal" }),
    ).not.toBeInTheDocument()
  })

  it.each([401, 403])(
    "does not recover actions from metadata after summary authorization fails with %s",
    async (status) => {
      mocks.summary.mockRejectedValue(
        new ApiError(status, "forbidden", "Forbidden"),
      )
      mocks.capabilities.mockResolvedValue({ ...capabilities(), account })
      render(page())
      await screen.findByText(
        status === 401 ? "Sign In Required" : "Billing Access Required",
      )
      expect(
        screen.queryByRole("button", { name: "Open Customer Portal" }),
      ).not.toBeInTheDocument()
    },
  )

  it("ends the loading state after one request deadline without retrying", async () => {
    mocks.summary.mockRejectedValue(new DOMException("Aborted", "AbortError"))
    mocks.usage.mockRejectedValue(new DOMException("Aborted", "AbortError"))
    render(page())
    expect(
      await screen.findAllByText(
        "The usage request timed out. Retry to check for updated usage and charges.",
      ),
    ).toHaveLength(2)
    expect(mocks.summary).toHaveBeenCalledTimes(1)
    expect(mocks.usage).toHaveBeenCalledTimes(1)
  })
})

it("keeps unavailable states stable until manual recovery, then resumes polling", async () => {
  vi.useFakeTimers()
  try {
    render(page())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10)
    })
    expect(
      screen.getAllByRole("region", { name: "Usage unavailable" }),
    ).toHaveLength(2)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(180_000)
    })
    expect(mocks.summary).toHaveBeenCalledTimes(1)
    expect(mocks.usage).toHaveBeenCalledTimes(1)
    mocks.summary.mockResolvedValue(knownSummary())
    fireEvent.click(screen.getAllByRole("button", { name: "Retry usage" })[0])
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10)
    })
    expect(screen.getByTestId("billing-statement")).toBeInTheDocument()
    expect(mocks.summary).toHaveBeenCalledTimes(2)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(mocks.summary).toHaveBeenCalledTimes(3)
  } finally {
    vi.useRealTimers()
  }
})
