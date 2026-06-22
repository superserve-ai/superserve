import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import PlanUsagePage from "./page"

const useBillingUsage = vi.fn()
const useUser = vi.fn()

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}))

vi.mock("@/hooks/use-billing-usage", () => ({
  useBillingUsage: (...args: unknown[]) => useBillingUsage(...args),
}))

vi.mock("@/hooks/use-user", () => ({
  useUser: () => useUser(),
}))

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

    expect(screen.getByText("Free During Preview")).toBeInTheDocument()
    expect(screen.queryByText("Hourly Usage")).not.toBeInTheDocument()
  })

  it("shows a not-charged indicator for shadow usage", () => {
    useBillingUsage.mockReturnValue({
      data: {
        enabled: true,
        billing_mode: "shadow",
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
      screen.getByText("Your team is not being charged for this usage yet."),
    ).toBeInTheDocument()
    expect(screen.getByText("Usage Trends")).toBeInTheDocument()
    expect(screen.getAllByText("CPU Usage")[0]).toBeInTheDocument()
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
    expect(screen.getByText("Usage Trends")).toBeInTheDocument()
  })
})
