import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "@/lib/api/client"

import PlanUsagePage from "./page"
import { bucketLabel, formatUsageCost } from "./page-client"

const useBillingSummary = vi.fn()
const useBillingUsage = vi.fn()
const useSandboxesPage = vi.fn()
const useUser = vi.fn()
const useTeams = vi.fn()
const useDashboardTeamContext = vi.fn()
const useCustomerBillingPeriods = vi.fn()
const useCustomerBillingUsage = vi.fn()
const useCustomerBillingExportPreview = vi.fn()

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
  usePathname: () => "/plan-usage",
}))

vi.mock("@/hooks/use-billing-usage", () => ({
  useBillingUsage: (...args: unknown[]) => useBillingUsage(...args),
}))

vi.mock("@/hooks/use-sandboxes", () => ({
  useSandboxesPage: (...args: unknown[]) => useSandboxesPage(...args),
}))

vi.mock("@/hooks/use-teams", () => ({
  useTeams: () => useTeams(),
}))

vi.mock("@/hooks/use-customer-billing", () => ({
  useCustomerBillingPeriods: (...args: unknown[]) =>
    useCustomerBillingPeriods(...args),
  useCustomerBillingUsage: (...args: unknown[]) =>
    useCustomerBillingUsage(...args),
  useCustomerBillingExportPreview: (...args: unknown[]) =>
    useCustomerBillingExportPreview(...args),
}))

vi.mock("@/hooks/use-billing-summary", () => ({
  useBillingSummary: (...args: unknown[]) => useBillingSummary(...args),
}))

vi.mock("@/hooks/use-user", () => ({
  useUser: () => useUser(),
}))

vi.mock("@/components/query-provider", () => ({
  useDashboardTeamContext: () => useDashboardTeamContext(),
  useQueryScope: () => "self",
}))

vi.mock("@superserve/ui", async () => {
  const actual =
    await vi.importActual<typeof import("@superserve/ui")>("@superserve/ui")
  return {
    ...actual,
    useToast: () => ({ addToast: vi.fn() }),
  }
})

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <PlanUsagePage />
    </QueryClientProvider>,
  )
}

describe("PlanUsagePage", () => {
  beforeEach(() => {
    useUser.mockReturnValue({
      user: { id: "user-1" },
      loading: false,
    })
    useDashboardTeamContext.mockReturnValue(null)
    useTeams.mockReturnValue({
      data: {
        teams: [{ id: "team-1", name: "Pilot Team", region: "use" }],
        activeTeamId: "team-1",
        activeRegion: "use",
      },
      isPending: false,
      error: null,
      refetch: vi.fn(),
    })
    useCustomerBillingPeriods.mockReturnValue({
      data: {
        periods: [
          {
            period_id: "2026-06-01T00:00:00.000Z,2026-07-01T00:00:00.000Z",
            period_start: "2026-06-01T00:00:00.000Z",
            period_end: "2026-07-01T00:00:00.000Z",
            status: "active",
            stripe_customer_id: "cus_test",
            stripe_subscription_status: "active",
            finalized_at: "2026-06-30T00:00:00.000Z",
            exported_at: "2026-06-30T00:05:00.000Z",
          },
        ],
      },
      isPending: false,
      error: null,
      refetch: vi.fn(),
    })
    useCustomerBillingExportPreview.mockReset()
    useCustomerBillingExportPreview.mockReturnValue({
      data: {
        mode: "live",
        period_id: "2026-06-01T00:00:00.000Z,2026-07-01T00:00:00.000Z",
        team_id: "team-1",
        status: "active",
        items: [],
        attempts: [],
      },
      isPending: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    })
    useCustomerBillingUsage.mockReturnValue({
      data: {
        period_id: "2026-06-01T00:00:00.000Z,2026-07-01T00:00:00.000Z",
        team_id: "team-1",
        status: "active",
        period_start: "2026-06-01T00:00:00.000Z",
        period_end: "2026-07-01T00:00:00.000Z",
        vcpu_seconds: 120,
        memory_mib_seconds: 2048,
        storage_mib_seconds: 4096,
        cpu_vcpu_hours: 0.0333,
        memory_gib_hours: 0.5555,
        storage_gib_hours: 1.1111,
        updated_at: "2026-06-30T12:05:00.000Z",
      },
      isPending: false,
      error: null,
      refetch: vi.fn(),
    })
    useSandboxesPage.mockImplementation(({ status }: { status?: string }) => {
      const totals: Record<string, number> = {
        active: 5,
        resuming: 1,
        paused: 3,
        failed: 2,
      }

      return {
        data: {
          total: totals[status ?? ""] ?? 0,
          items:
            status === "active"
              ? [
                  {
                    id: "sandbox-1",
                    name: "alpha",
                    status: "active",
                    vcpu_count: 1,
                    memory_mib: 1024,
                    metadata: {},
                    created_at: "2026-06-30T12:00:00.000Z",
                  },
                ]
              : [],
        },
        isPending: false,
        error: null,
        refetch: vi.fn(),
      }
    })
    useBillingSummary.mockReturnValue({
      data: {
        billing_mode: "live",
        checkout_available: true,
        portal_available: true,
        payment_setup_required: false,
        permissions: {
          can_view: true,
          can_manage: true,
        },
        current_charges_usd: 123.45,
        credits_applied_usd: 23.45,
        credits_remaining_usd: 76.55,
        expected_invoice_amount_usd: 100,
        cost_breakdown_usd: {
          compute: 60,
          memory: 40,
          storage: 23.45,
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
            charge_usd: 60,
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
            charge_usd: 40,
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
            charge_usd: 0,
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
        calculated_at: "2026-06-30T12:30:00.000Z",
      },
      isPending: false,
      error: null,
      refetch: vi.fn(),
    })
  })

  it("never requests an invalid aggregation when the billing period changes", () => {
    useBillingUsage.mockReturnValue({
      data: { buckets: [], rows: [{ vcpu_seconds: 1 }] },
      isPending: false,
    })
    const summary = useBillingSummary()
    const view = renderPage()
    fireEvent.change(screen.getByRole("combobox", { name: "View by" }), {
      target: { value: "weekly" },
    })
    useBillingSummary.mockReturnValue({
      ...summary,
      data: {
        ...summary.data,
        billing_period: {
          start: "2026-06-01T00:00:00.000Z",
          end: "2026-06-03T00:00:00.000Z",
        },
      },
    })
    useBillingUsage.mockClear()
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <PlanUsagePage />
      </QueryClientProvider>,
    )
    expect(useBillingUsage).toHaveBeenCalled()
    for (const call of useBillingUsage.mock.calls) {
      expect(call[2]).toBe("hourly")
    }
  })

  it("removes retained summary claims when a refresh fails and allows retry", () => {
    const summaryQuery = useBillingSummary()
    const refetch = vi.fn()
    useBillingSummary.mockReturnValue({
      ...summaryQuery,
      error: new Error("refresh failed"),
      refetch,
    })
    useBillingUsage.mockReturnValue({
      data: { buckets: [] },
      isPending: false,
      error: null,
    })
    renderPage()

    expect(screen.queryByText("Pay-as-you-go • USD")).not.toBeInTheDocument()
    expect(screen.queryByText("Current Balance")).not.toBeInTheDocument()
    expect(screen.queryByText("Billing is live")).not.toBeInTheDocument()
    expect(screen.queryByText("Tracked but not billed")).not.toBeInTheDocument()
    expect(screen.queryByText("Charge: $60.00")).not.toBeInTheDocument()
    expect(
      screen.getByText("Billing data is unavailable for this team right now."),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /try again/i }))
    expect(refetch).toHaveBeenCalledOnce()
  })

  it("keeps the viewed period through a refresh error and adopts the recovered period", () => {
    const summaryQuery = useBillingSummary()
    useBillingUsage.mockClear()
    useBillingUsage.mockReturnValue({
      data: { buckets: [] },
      isPending: false,
      error: null,
    })
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const page = () => (
      <QueryClientProvider client={client}>
        <PlanUsagePage />
      </QueryClientProvider>
    )
    const { rerender } = render(page())
    const assertRange = (start: string, end: string) => {
      expect(useBillingUsage).toHaveBeenCalled()
      for (const call of useBillingUsage.mock.calls) {
        expect(call).toEqual([
          new Date(start),
          new Date(end),
          "daily",
          expect.any(String),
          true,
        ])
      }
    }
    assertRange("2026-06-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z")
    useBillingUsage.mockClear()
    useBillingSummary.mockReturnValue({
      ...summaryQuery,
      error: new Error("refresh failed"),
    })
    rerender(page())
    assertRange("2026-06-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z")
    expect(screen.queryByText("Current Balance")).not.toBeInTheDocument()
    expect(screen.queryByText("Billing is live")).not.toBeInTheDocument()

    useBillingUsage.mockClear()
    useBillingSummary.mockReturnValue({
      ...summaryQuery,
      data: {
        ...summaryQuery.data,
        billing_period: {
          start: "2026-07-01T00:00:00.000Z",
          end: "2026-08-01T00:00:00.000Z",
        },
      },
    })
    rerender(page())
    assertRange("2026-07-01T00:00:00.000Z", "2026-08-01T00:00:00.000Z")
    expect(screen.getByText("Current Balance")).toBeInTheDocument()
  })

  it("shows the preview state when billing dashboard access is disabled", () => {
    useBillingUsage.mockReturnValue({
      data: {
        enabled: false,
        billing_mode: "disabled",
        period_start: "2026-06-01T00:00:00.000Z",
        period_end: "2026-06-02T00:00:00.000Z",
        rows: [],
      },
      isPending: false,
      error: null,
      refetch: vi.fn(),
    })

    renderPage()

    expect(screen.queryByText("Free During Preview")).not.toBeInTheDocument()
    expect(screen.queryByText("Pay-as-you-go • USD")).toBeInTheDocument()
    expect(useBillingUsage).toHaveBeenCalledWith(
      new Date("2026-06-01T00:00:00.000Z"),
      new Date("2026-07-01T00:00:00.000Z"),
      "daily",
      expect.any(String),
      true,
    )
  })

  it("shows a not-charged indicator for shadow usage", () => {
    const summaryQuery = useBillingSummary.mock.results[0]?.value
    useBillingSummary.mockReturnValue({
      ...summaryQuery,
      data: { ...summaryQuery.data, billing_mode: "shadow" },
    })
    useBillingUsage.mockReturnValue({
      data: {
        enabled: true,
        start: "2026-06-01T00:00:00.000Z",
        end: "2026-07-01T00:00:00.000Z",
        granularity: "day",
        timezone: "UTC",
        buckets: [
          {
            start: "2026-06-01T00:00:00.000Z",
            end: "2026-06-02T00:00:00.000Z",
            cpu: { usage: 120, cost_usd: 60, tracked: true, billable: true },
            memory: {
              usage: 2048,
              cost_usd: 40,
              tracked: true,
              billable: true,
            },
            storage: {
              usage: 4096,
              cost_usd: 0,
              tracked: true,
              billable: false,
            },
            billed_total_usd: 100,
          },
        ],
      },
      isPending: false,
      error: null,
      refetch: vi.fn(),
    })

    renderPage()

    expect(
      screen.getByText("Your team is not being charged for this usage yet."),
    ).toBeInTheDocument()
    expect(screen.getByTestId("usage-cost-chart")).toBeInTheDocument()
    expect(
      screen.queryByTestId("sandbox-state-section"),
    ).not.toBeInTheDocument()
    expect(
      within(screen.getByTestId("customer-billing-section")).getByText(
        "Billing Period",
      ),
    ).toBeInTheDocument()
    expect(screen.getByText("Pay-as-you-go • USD")).toBeInTheDocument()
    expect(
      within(screen.getByTestId("customer-billing-section")).getByText(
        "Credits remaining: $76.55",
      ),
    ).toBeInTheDocument()
    expect(screen.getByText("Running")).toBeInTheDocument()
    expect(screen.getByText("Paused")).toBeInTheDocument()
  })

  it.each([
    {
      name: "billed maximum",
      cpu: 0.006,
      memory: 0.004,
      storage: 0.005,
      heights: [60, 40, 50],
    },
    {
      name: "storage maximum",
      cpu: 0.002,
      memory: 0.003,
      storage: 0.01,
      heights: [20, 30, 100],
    },
    {
      name: "zero costs with nonzero usage",
      cpu: 0,
      memory: 0,
      storage: 0,
      heights: [0, 0, 0],
    },
  ])(
    "scales bars to the dataset's $name",
    ({ cpu, memory, storage, heights }) => {
      useBillingUsage.mockReturnValue({
        data: {
          start: "2026-06-01T00:00:00.000Z",
          end: "2026-06-01T02:00:00.000Z",
          granularity: "hour",
          timezone: "UTC",
          buckets: [1, 0.5].map((factor, index) => ({
            start: `2026-06-01T0${index}:00:00.000Z`,
            end: `2026-06-01T0${index + 1}:00:00.000Z`,
            cpu: {
              usage: 1,
              cost_usd: cpu * factor,
              tracked: true,
              billable: true,
            },
            memory: {
              usage: 1,
              cost_usd: memory * factor,
              tracked: true,
              billable: true,
            },
            storage: {
              usage: 1,
              cost_usd: storage * factor,
              tracked: true,
              billable: false,
            },
            billed_total_usd: (cpu + memory) * factor,
          })),
        },
        isPending: false,
        error: null,
        refetch: vi.fn(),
      })

      renderPage()

      const stacks = screen.getAllByTestId("billed-cost-stack")
      const storageBars = screen.getAllByTestId("storage-equivalent-bar")
      expect(stacks).toHaveLength(2)
      for (const [index, factor] of [1, 0.5].entries()) {
        const stack = within(stacks[index])
        expect(stack.getByLabelText(/^CPU /)).toHaveStyle({
          height: `${heights[0] * factor}%`,
        })
        expect(stack.getByLabelText(/^Memory /)).toHaveStyle({
          height: `${heights[1] * factor}%`,
        })
        expect(storageBars[index]).toHaveStyle({
          height: `${heights[2] * factor}%`,
        })
      }
    },
  )

  it("shows the no-usage state when every bucket resource is zero", () => {
    useBillingUsage.mockReturnValue({
      data: {
        start: "2026-06-01T00:00:00.000Z",
        end: "2026-07-01T00:00:00.000Z",
        granularity: "day",
        timezone: "UTC",
        buckets: [
          {
            start: "2026-06-01T00:00:00.000Z",
            end: "2026-06-02T00:00:00.000Z",
            cpu: { usage: 0, cost_usd: 0, tracked: true, billable: true },
            memory: { usage: 0, cost_usd: 0, tracked: true, billable: true },
            storage: { usage: 0, cost_usd: 0, tracked: true, billable: false },
            billed_total_usd: 0,
          },
        ],
      },
      isPending: false,
      error: null,
      refetch: vi.fn(),
    })

    renderPage()

    expect(screen.getByText("No Usage For This Period")).toBeInTheDocument()
    expect(screen.queryByTestId("usage-cost-chart")).not.toBeInTheDocument()
  })

  it.each([0, 1.2])(
    "preserves the page with unknown storage usage and %s compute charges",
    (computeCost) => {
      const summary = structuredClone(useBillingSummary().data)
      summary.resources.find(
        (resource: { resource_key: string }) =>
          resource.resource_key === "storage_gib",
      ).usage = null
      useBillingSummary.mockReturnValue({
        data: summary,
        isPending: false,
        error: null,
        refetch: vi.fn(),
      })
      useBillingUsage.mockReturnValue({
        data: {
          start: "2026-06-01T00:00:00.000Z",
          end: "2026-07-01T00:00:00.000Z",
          granularity: "day",
          timezone: "UTC",
          buckets: [
            {
              start: "2026-06-01T00:00:00.000Z",
              end: "2026-06-02T00:00:00.000Z",
              cpu: {
                usage: computeCost === 0 ? 0 : 3600,
                cost_usd: computeCost,
                tracked: true,
                billable: true,
              },
              memory: { usage: 0, cost_usd: 0, tracked: true, billable: true },
              storage: {
                usage: null,
                cost_usd: 0,
                tracked: true,
                billable: false,
              },
              billed_total_usd: computeCost,
            },
          ],
        },
        isPending: false,
        error: null,
        refetch: vi.fn(),
      })
      renderPage()
      expect(screen.getByTestId("billing-statement")).toBeInTheDocument()
      expect(screen.getByTestId("usage-cost-chart")).toBeInTheDocument()
      expect(
        screen.getByText(/Some storage usage measurements are unavailable/),
      ).toBeInTheDocument()
      expect(
        screen.queryByText("No Usage For This Period"),
      ).not.toBeInTheDocument()
      expect(
        screen.getByRole("button", {
          name: /Storage \$0.00 \(not billed\) · usage unavailable/,
        }),
      ).toHaveAccessibleName(new RegExp(`CPU \\$${computeCost.toFixed(2)}`))
    },
  )

  it("uses backend bucket boundaries for monthly labels and tooltip ranges", () => {
    useCustomerBillingPeriods.mockReturnValue({
      data: {
        periods: [
          {
            period_id: "2025-11-15T12:00:00.000Z,2026-02-15T12:00:00.000Z",
            period_start: "2025-11-15T12:00:00.000Z",
            period_end: "2026-02-15T12:00:00.000Z",
            status: "active",
            stripe_customer_id: "cus_test",
            stripe_subscription_status: "active",
            finalized_at: "2026-02-01T00:00:00.000Z",
            exported_at: "2026-02-01T00:05:00.000Z",
          },
        ],
      },
      isPending: false,
      error: null,
      refetch: vi.fn(),
    })
    useBillingUsage.mockReturnValue({
      data: {
        start: "2025-11-15T12:00:00.000Z",
        end: "2026-02-15T12:00:00.000Z",
        granularity: "month",
        timezone: "UTC",
        buckets: [
          {
            start: "2025-12-15T00:00:00.000Z",
            end: "2026-01-01T00:00:00.000Z",
            cpu: { usage: 1, cost_usd: 1, tracked: true, billable: true },
            memory: { usage: 1, cost_usd: 2, tracked: true, billable: true },
            storage: { usage: 1, cost_usd: 3, tracked: true, billable: false },
            billed_total_usd: 3,
          },
          {
            start: "2026-01-01T00:00:00.000Z",
            end: "2026-02-15T12:00:00.000Z",
            cpu: { usage: 1, cost_usd: 4, tracked: true, billable: true },
            memory: { usage: 1, cost_usd: 5, tracked: true, billable: true },
            storage: { usage: 1, cost_usd: 6, tracked: true, billable: false },
            billed_total_usd: 9,
          },
        ],
      },
      isPending: false,
      error: null,
      refetch: vi.fn(),
    })

    renderPage()

    const chart = screen.getByTestId("usage-cost-chart")
    expect(chart).toHaveTextContent("Dec 2025")
    expect(chart).toHaveTextContent("Jan 2026")
    expect(
      within(chart).getAllByLabelText(/CPU \$1\.00/).length,
    ).toBeGreaterThan(0)
    expect(
      within(chart).getAllByLabelText(/CPU \$4\.00/).length,
    ).toBeGreaterThan(0)
    expect(bucketLabel("2025-12-15T00:00:00.000Z", "monthly", true)).toMatch(
      /Dec 2025/,
    )
    expect(bucketLabel("2026-01-01T00:00:00.000Z", "monthly", true)).toMatch(
      /Jan 2026/,
    )
  })

  it("keeps mixed storage eligibility neutral and preserves returned historical costs", () => {
    useBillingUsage.mockReturnValue({
      data: {
        start: "2026-06-01T00:00:00.000Z",
        end: "2026-07-01T00:00:00.000Z",
        granularity: "day",
        timezone: "UTC",
        buckets: [
          {
            start: "2026-06-01T00:00:00.000Z",
            end: "2026-06-02T00:00:00.000Z",
            cpu: { usage: 1, cost_usd: 1, tracked: true, billable: true },
            memory: { usage: 1, cost_usd: 2, tracked: true, billable: true },
            storage: {
              usage: 1000,
              // This is the backend's historical pre-activation amount.
              cost_usd: 17.25,
              tracked: true,
              billable: false,
            },
            billed_total_usd: 3,
          },
          {
            start: "2026-06-02T00:00:00.000Z",
            end: "2026-06-03T00:00:00.000Z",
            cpu: { usage: 1, cost_usd: 4, tracked: true, billable: true },
            memory: { usage: 1, cost_usd: 5, tracked: true, billable: true },
            storage: {
              usage: 1000,
              // Keep this distinct from the current rate-derived amount.
              cost_usd: 23.75,
              tracked: true,
              billable: true,
            },
            billed_total_usd: 32.75,
          },
        ],
      },
      isPending: false,
      error: null,
      refetch: vi.fn(),
    })

    renderPage()

    expect(
      screen.getByText("Storage (mixed billing eligibility)"),
    ).toBeInTheDocument()
    expect(
      screen.getByLabelText(/Storage \$17\.25 \(not billed\)/),
    ).toBeInTheDocument()
    expect(
      screen.getByLabelText(/Storage \$23\.75(?! \(not billed\))/),
    ).toBeInTheDocument()
    expect(screen.getByLabelText(/Billed total \$32\.75/)).toBeInTheDocument()
  })

  it("does not add not-billed copy when every storage bucket is billable", () => {
    useBillingUsage.mockReturnValue({
      data: {
        start: "2026-06-01T00:00:00.000Z",
        end: "2026-06-02T00:00:00.000Z",
        granularity: "day",
        timezone: "UTC",
        buckets: [
          {
            start: "2026-06-01T00:00:00.000Z",
            end: "2026-06-02T00:00:00.000Z",
            cpu: { usage: 1, cost_usd: 1, tracked: true, billable: true },
            memory: { usage: 1, cost_usd: 2, tracked: true, billable: true },
            storage: {
              usage: 1000,
              cost_usd: 23.75,
              tracked: true,
              billable: true,
            },
            billed_total_usd: 26.75,
          },
        ],
      },
      isPending: false,
      error: null,
      refetch: vi.fn(),
    })

    renderPage()

    expect(
      within(screen.getByTestId("usage-cost-chart")).getByText("Storage"),
    ).toBeInTheDocument()
    expect(
      screen.queryByText("Storage equivalent (not billed)"),
    ).not.toBeInTheDocument()
    expect(
      screen.getByLabelText(/Storage \$23\.75(?! \(not billed\))/),
    ).toBeInTheDocument()
  })

  it("does not show the not-charged indicator for active usage", () => {
    useBillingUsage.mockReturnValue({
      data: {
        enabled: true,
        billing_mode: "active",
        period_start: "2026-06-01T00:00:00.000Z",
        period_end: "2026-06-02T00:00:00.000Z",
        rows: [
          {
            hour_start: "2026-06-01T00:00:00.000Z",
            hour_end: "2026-06-01T01:00:00.000Z",
            vcpu_seconds: 120,
            memory_mib_seconds: 2048,
            storage_mib_seconds: 4096,
            updated_at: "2026-06-01T01:05:00.000Z",
          },
        ],
      },
      isPending: false,
      error: null,
      refetch: vi.fn(),
    })

    renderPage()

    expect(
      screen.queryByText(/not being charged for this usage yet/i),
    ).not.toBeInTheDocument()
    expect(screen.getByText("Usage Details")).toBeInTheDocument()
    expect(screen.queryByText(/Last updated:/i)).not.toBeInTheDocument()
    expect(screen.getByText("Pay-as-you-go • USD")).toBeInTheDocument()
    expect(screen.queryByTestId("usage-cards-grid")).not.toBeInTheDocument()
    expect(screen.queryByTestId("sandboxes-card")).not.toBeInTheDocument()
    expect(screen.queryByTestId("compute-section")).not.toBeInTheDocument()
    expect(screen.queryByTestId("storage-section")).not.toBeInTheDocument()
    expect(
      screen.queryByTestId("sandbox-state-section"),
    ).not.toBeInTheDocument()
    expect(screen.queryByText("CPU Usage")).not.toBeInTheDocument()
    expect(screen.queryByText("Memory Usage")).not.toBeInTheDocument()
    expect(screen.queryByText("Storage Context")).not.toBeInTheDocument()
  })

  it("keeps usage visible when billing summary access is denied", () => {
    useBillingSummary.mockReturnValue({
      data: undefined,
      isPending: false,
      error: new ApiError(403, "forbidden", "Forbidden"),
      refetch: vi.fn(),
    })
    useBillingUsage.mockReturnValue({
      data: {
        enabled: true,
        billing_mode: "active",
        period_start: "2026-06-01T00:00:00.000Z",
        period_end: "2026-06-02T00:00:00.000Z",
        rows: [
          {
            hour_start: "2026-06-01T00:00:00.000Z",
            hour_end: "2026-06-01T01:00:00.000Z",
            vcpu_seconds: 120,
            memory_mib_seconds: 2048,
            storage_mib_seconds: 4096,
            updated_at: "2026-06-01T01:05:00.000Z",
          },
        ],
      },
      isPending: false,
      error: null,
      refetch: vi.fn(),
    })

    renderPage()

    expect(screen.getByText("Billing Access Required")).toBeInTheDocument()
    expect(screen.getByText("Usage Details")).toBeInTheDocument()
    expect(screen.getByTestId("compute-section")).toBeInTheDocument()
    expect(screen.getByTestId("storage-section")).toBeInTheDocument()
    expect(screen.queryByText("CPU Usage")).not.toBeInTheDocument()
  })

  it("shows customer billing for impersonated teams outside the member directory", () => {
    useDashboardTeamContext.mockReturnValue({
      teamId: "impersonated-team",
      region: "use",
      name: "Impersonated Team",
    })
    useTeams.mockReturnValue({
      data: {
        teams: [],
        activeTeamId: "team-1",
        activeRegion: "use",
      },
      isPending: false,
      error: null,
      refetch: vi.fn(),
    })

    renderPage()

    expect(screen.getByTestId("customer-billing-section")).toBeInTheDocument()
    expect(useCustomerBillingPeriods).toHaveBeenCalledWith(
      "impersonated-team",
      "use:impersonated-team",
    )
  })
})

describe("hourly bucket labels", () => {
  it("distinguishes the same hour on consecutive days", () => {
    expect(bucketLabel("2026-06-01T05:00:00Z", "hourly", false, "UTC")).toMatch(
      /Jun 1.*5 AM/,
    )
    expect(bucketLabel("2026-06-02T05:00:00Z", "hourly", false, "UTC")).toMatch(
      /Jun 2.*5 AM/,
    )
  })

  it("uses the series timezone for both the date and hour", () => {
    expect(
      bucketLabel("2026-06-01T00:00:00Z", "hourly", false, "America/Chicago"),
    ).toMatch(/May 31.*7 PM/)
  })
})

describe("usage cost precision", () => {
  it.each([
    [0, "0.00"],
    [1.23, "1.23"],
    [0.01, "0.01"],
    [0.004, "0.004"],
    [0.00001234, "0.000012"],
  ])("formats %s without hiding small positive costs", (value, expected) => {
    expect(formatUsageCost(value)).toBe(expected)
  })
})
