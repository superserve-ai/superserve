import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { BillingSummaryResponse } from "@/lib/api/billing"

import { TrialBillingBanner } from "./trial-billing-banner"

const mocks = vi.hoisted(() => ({
  summary: vi.fn(),
  payment: vi.fn(),
  context: vi.fn(),
}))
vi.mock("@/hooks/use-billing-summary", () => ({
  useBillingSummary: mocks.summary,
}))
vi.mock("@/hooks/use-billing-payment", () => ({
  useBillingPayment: mocks.payment,
}))
vi.mock("@/hooks/use-billing-context", () => ({
  useBillingContext: mocks.context,
}))
vi.mock("next/navigation", () => ({ usePathname: () => "/sandboxes/" }))

function summary(overrides: Partial<BillingSummaryResponse> = {}) {
  return {
    permissions: { can_view: true, can_manage: true },
    trial: { state: "active", remaining_usd: 3.25, runway_state: "over_24h" },
    ...overrides,
  }
}
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const invalidate = vi.spyOn(client, "invalidateQueries")
  const result = render(
    <QueryClientProvider client={client}>
      <TrialBillingBanner />
    </QueryClientProvider>,
  )
  return { ...result, client, invalidate }
}

beforeEach(() => {
  mocks.summary.mockReturnValue({ data: summary(), isError: false })
  mocks.context.mockReturnValue({ teamKey: "use:a", ready: true })
  mocks.payment.mockReturnValue({
    submitting: null,
    available: true,
    openSession: vi.fn(),
  })
  window.history.replaceState({}, "", "/sandboxes/")
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("TrialBillingBanner", () => {
  it("shows full trial balance and incentive without a dismiss action", () => {
    mount()
    expect(screen.getByRole("status")).toHaveClass("bg-yellow-100")
    expect(screen.getByText("$3.25 remaining")).toBeInTheDocument()
    expect(screen.getByText("$95 in additional credits")).toBeInTheDocument()
    expect(screen.getAllByRole("button")).toHaveLength(1)
  })

  it.each([null, undefined, Number.NaN])(
    "omits unavailable balance %s",
    (remaining_usd) => {
      mocks.summary.mockReturnValue({
        data: summary({ trial: { state: "active", remaining_usd } }),
      })
      mount()
      expect(screen.getByRole("status")).toHaveClass("bg-yellow-100")
      expect(screen.getByRole("status")).not.toHaveTextContent("$0.00")
    },
  )

  it.each([0, 0.001])(
    "does not infer exhaustion from formatted balance %s",
    (remaining_usd) => {
      mocks.summary.mockReturnValue({
        data: summary({ trial: { state: "active", remaining_usd } }),
      })
      mount()
      expect(screen.getByRole("status")).toHaveClass("bg-yellow-100")
      expect(screen.getByRole("status")).not.toHaveTextContent("has run out")
    },
  )

  it.each(["no_grant", "expired", "ended_by_billing_activation", "unexpected"])(
    "hides lifecycle %s",
    (state) => {
      mocks.summary.mockReturnValue({ data: summary({ trial: { state } }) })
      mount()
      expect(screen.queryByRole("status")).not.toBeInTheDocument()
    },
  )

  it.each([
    { data: undefined },
    { data: summary({ trial: undefined }) },
    { data: summary({ permissions: { can_view: false, can_manage: true } }) },
    { data: summary(), isError: true },
  ])("hides unresolved, denied or failed data", (value) => {
    mocks.summary.mockReturnValue(value)
    mount()
    expect(screen.queryByRole("status")).not.toBeInTheDocument()
  })

  it("keeps exhausted copy despite ineligibility and missing runway", () => {
    mocks.summary.mockReturnValue({
      data: summary({ trial: { state: "exhausted", eligible: false } }),
    })
    mount()
    expect(screen.getByRole("status")).toHaveClass("bg-red-100")
    expect(screen.getByRole("status")).toHaveTextContent(
      "Your free trial credit has run out. Add a payment method to unlock $95 in credits and restore sandbox access.",
    )
    expect(screen.getByRole("status")).not.toHaveTextContent(
      /paused|delet|7.day/i,
    )
  })

  it("gives readers only the administrator instruction", () => {
    mocks.summary.mockReturnValue({
      data: summary({ permissions: { can_view: true, can_manage: false } }),
    })
    mount()
    expect(
      screen.getByText("Contact your team's billing administrator."),
    ).toBeInTheDocument()
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
  })

  it("disables unavailable payment setup", () => {
    mocks.payment.mockReturnValue({ available: false })
    mount()
    expect(screen.getByRole("button", { name: "Add Payment" })).toBeDisabled()
  })

  it.each(["unknown", undefined, "over_24h"] as const)(
    "uses yellow for runway %s",
    (runway_state) => {
      mocks.summary.mockReturnValue({
        data: summary({
          trial: { state: "active", runway_state },
        }),
      })
      mount()
      expect(screen.getByRole("status")).toHaveClass("bg-yellow-100")
    },
  )

  it.each([undefined, "invalid", "2020-01-01", "2099-01-01"])(
    "rejects stale or invalid urgent observation %s",
    (runway_observed_at) => {
      mocks.summary.mockReturnValue({
        data: summary({
          trial: {
            state: "active",
            runway_state: "under_24h",
            runway_observed_at,
          },
        }),
      })
      mount()
      expect(screen.getByRole("status")).toHaveClass("bg-yellow-100")
    },
  )

  it("updates urgent color and copy when backend runway returns to over_24h", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-09-17T12:00:00Z"))
    const trial = {
      state: "active",
      remaining_usd: 3.25,
      runway_observed_at: "2026-09-17T12:00:00Z",
    }
    mocks.summary.mockReturnValue({
      data: summary({ trial: { ...trial, runway_state: "under_24h" } }),
    })
    const { client, rerender } = mount()
    expect(screen.getByRole("status")).toHaveClass("bg-red-100")
    expect(screen.getByRole("status")).toHaveTextContent(
      "Based on your recent usage, your trial credit may run out within the next 24 hours. Add a payment method to unlock $95 in credits and keep your sandboxes running.",
    )

    mocks.summary.mockReturnValue({
      data: summary({ trial: { ...trial, runway_state: "over_24h" } }),
    })
    rerender(
      <QueryClientProvider client={client}>
        <TrialBillingBanner />
      </QueryClientProvider>,
    )
    expect(screen.getByRole("status")).toHaveClass("bg-yellow-100")
    expect(screen.getByRole("status")).not.toHaveClass("bg-red-100")
    expect(screen.getByRole("status")).toHaveTextContent(
      "You're on a free trial with $3.25 remaining. Add a payment method to unlock $95 in additional credits.",
    )
    expect(screen.getByRole("status")).not.toHaveTextContent("recent usage")
  })

  it("expires cached urgency at the backend freshness boundary", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-09-17T12:00:00Z"))
    mocks.summary.mockReturnValue({
      data: summary({
        trial: {
          state: "active",
          runway_state: "under_24h",
          runway_observed_at: "2026-09-17T11:45:01Z",
        },
      }),
    })
    mount()
    expect(screen.getByRole("status")).toHaveClass("bg-red-100")
    act(() => vi.advanceTimersByTime(1000))
    expect(screen.getByRole("status")).toHaveClass("bg-yellow-100")
  })

  it("refreshes on payment return without treating success as activation", () => {
    window.history.replaceState({}, "", "/sandboxes/?billing=success")
    const { invalidate, rerender } = mount()
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["billing"] })
    expect(screen.getByRole("status")).toBeInTheDocument()
    mocks.summary.mockReturnValue({
      data: summary({ trial: { state: "ended_by_billing_activation" } }),
    })
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <TrialBillingBanner />
      </QueryClientProvider>,
    )
    expect(screen.queryByRole("status")).not.toBeInTheDocument()
  })

  it("hides cached data while the team switch is pending", () => {
    mocks.context.mockReturnValue({ teamKey: "use:b", ready: false })
    mount()
    expect(screen.queryByRole("status")).not.toBeInTheDocument()
    expect(mocks.payment).toHaveBeenCalledWith(undefined, "use:b")
  })
})
