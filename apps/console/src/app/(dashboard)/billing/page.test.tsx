import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "@/lib/api/client"

import BillingPage from "./page"

const useBillingSummary = vi.fn()
const useUser = vi.fn()

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}))

vi.mock("@/hooks/use-billing-summary", () => ({
  useBillingSummary: (...args: unknown[]) => useBillingSummary(...args),
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
      <BillingPage />
    </QueryClientProvider>,
  )
}

describe("BillingPage", () => {
  beforeEach(() => {
    useUser.mockReturnValue({
      user: { id: "user-1" },
      loading: false,
    })
    useBillingSummary.mockReturnValue({
      data: {
        current_charges_usd: 123.45,
        credits_applied_usd: 23.45,
        credits_remaining_usd: 76.55,
        expected_invoice_amount_usd: 100,
        cost_breakdown_usd: {
          compute: 60,
          memory: 40,
          storage: 23.45,
        },
        billing_period: {
          start: "2026-06-01T12:00:00.000Z",
          end: "2026-07-01T12:00:00.000Z",
        },
        pricing_tier: {
          plan_key: "payg",
          plan_name: "Pay-as-you-go",
          currency: "USD",
        },
        last_updated: "2026-06-30T12:30:00.000Z",
      },
      isPending: false,
      error: null,
      refetch: vi.fn(),
    })
  })

  it("renders the billing summary fields", () => {
    renderPage()

    expect(screen.getByText("Current Charges")).toBeInTheDocument()
    expect(screen.getByText("$123.45")).toBeInTheDocument()
    expect(screen.getByText("Credits Remaining")).toBeInTheDocument()
    expect(screen.getByText("$76.55")).toBeInTheDocument()
    expect(screen.getByText("Expected Invoice")).toBeInTheDocument()
    expect(screen.getByText("$100.00")).toBeInTheDocument()
    expect(screen.getByText("Cost Breakdown")).toBeInTheDocument()
    expect(screen.getByText("Compute")).toBeInTheDocument()
    expect(screen.getByText("Memory")).toBeInTheDocument()
    expect(screen.getByText("Storage")).toBeInTheDocument()
    expect(screen.getByText("Billing Period")).toBeInTheDocument()
    expect(screen.getByText("Last Updated")).toBeInTheDocument()
  })

  it("shows a billing permission error for 403s", () => {
    useBillingSummary.mockReturnValue({
      data: undefined,
      isPending: false,
      error: new ApiError(403, "forbidden", "Forbidden"),
      refetch: vi.fn(),
    })

    renderPage()

    expect(screen.getByText("Billing Access Required")).toBeInTheDocument()
    expect(
      screen.getByText(
        "Your account does not have billing read access for this team.",
      ),
    ).toBeInTheDocument()
  })
})
