import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { BillingSummaryResponse } from "@/lib/api/billing"

import { TrialBillingBanner, trialStage } from "./trial-billing-banner"

const mocks = vi.hoisted(() => ({
  summary: vi.fn(),
  payment: vi.fn(),
  context: vi.fn(),
  toast: vi.fn(),
  entry: vi.fn(),
  offers: undefined as unknown[] | undefined,
}))
vi.mock("@/hooks/use-billing-v2", () => ({ useTeamEntry: mocks.entry }))
vi.mock("@/hooks/use-billing-capabilities", () => ({
  useBillingCapabilities: () => ({ data: { offers: mocks.offers } }),
}))
vi.mock("@superserve/ui", async () => ({
  ...(await vi.importActual<typeof import("@superserve/ui")>("@superserve/ui")),
  useToast: () => ({ addToast: mocks.toast }),
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
vi.mock("next/navigation", () => ({
  usePathname: () => window.location.pathname,
}))

function summary(overrides: Partial<BillingSummaryResponse> = {}) {
  return {
    permissions: { can_view: true, can_manage: true },
    trial: { state: "active", remaining_usd: 3.25, runway_state: "over_24h" },
    ...overrides,
  }
}
function mount(requestedOffer?: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  if (requestedOffer)
    client.setQueryData(["signup-plan", "use:a"], { requestedOffer })
  const invalidate = vi.spyOn(client, "invalidateQueries")
  const result = render(
    <QueryClientProvider client={client}>
      <TrialBillingBanner />
    </QueryClientProvider>,
  )
  return { ...result, client, invalidate }
}

beforeEach(() => {
  mocks.toast.mockClear()
  mocks.offers = undefined
  mocks.entry.mockReturnValue({ data: null, isPending: false, isError: false })
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
    expect(screen.getByRole("status")).not.toHaveTextContent("$95")
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
      "Your free trial credit has run out. Add a payment method to continue running sandboxes.",
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
      "Based on your recent usage, your trial credit may run out within the next 24 hours, and any running sandboxes will automatically be stopped. Add a payment method to continue running sandboxes.",
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
      "You're on a free trial with $3.25 remaining. Add a payment method to keep running sandboxes once it's used up.",
    )
    expect(screen.getByRole("status")).not.toHaveTextContent("recent usage")
  })

  it.each([1, 60_000, 5 * 60_000])(
    "shows and expires urgent runway with the browser clock %s ms behind",
    (skew) => {
      vi.useFakeTimers()
      const now = Date.parse("2026-09-17T12:00:00Z")
      vi.setSystemTime(now)
      mocks.summary.mockReturnValue({
        data: summary({
          trial: {
            state: "active",
            runway_state: "under_24h",
            runway_observed_at: new Date(now + skew).toISOString(),
          },
        }),
      })
      mount()
      expect(screen.getByRole("status")).toHaveClass("bg-red-100")
      act(() => vi.advanceTimersByTime(15 * 60_000 + skew - 1))
      expect(screen.getByRole("status")).toHaveClass("bg-red-100")
      act(() => vi.advanceTimersByTime(1))
      expect(screen.getByRole("status")).toHaveClass("bg-yellow-100")
    },
  )

  it("rejects observations beyond the clock skew allowance", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-09-17T12:00:00Z"))
    mocks.summary.mockReturnValue({
      data: summary({
        trial: {
          state: "active",
          runway_state: "under_24h",
          runway_observed_at: "2026-09-17T12:05:00.001Z",
        },
      }),
    })
    mount()
    expect(screen.getByRole("status")).toHaveClass("bg-yellow-100")
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

  it.each([
    [
      "success",
      "Returned from Stripe. Billing status is refreshing against the latest server state.",
      "info",
    ],
    [
      "cancel",
      "Billing flow canceled. You can reopen billing setup any time.",
      "warning",
    ],
    [
      "portal-return",
      "Billing portal closed. Billing status is refreshing against the latest server state.",
      "info",
    ],
  ])(
    "consumes %s outside billing once even when the trial is hidden",
    (state, message, variant) => {
      mocks.summary.mockReturnValue({
        data: summary({ trial: { state: "ended_by_billing_activation" } }),
      })
      window.history.replaceState(
        { navigation: "preserved" },
        "",
        `/sandboxes/?tab=one&billing=${state}#details`,
      )
      const first = mount()
      expect(first.invalidate).toHaveBeenCalledTimes(1)
      expect(first.invalidate).toHaveBeenCalledWith({ queryKey: ["billing"] })
      expect(mocks.toast).toHaveBeenCalledTimes(1)
      expect(mocks.toast).toHaveBeenCalledWith(message, variant)
      expect(
        window.location.pathname +
          window.location.search +
          window.location.hash,
      ).toBe("/sandboxes/?tab=one#details")
      expect(window.history.state).toEqual({ navigation: "preserved" })
      first.unmount()
      const second = mount()
      expect(second.invalidate).not.toHaveBeenCalled()
      expect(mocks.toast).toHaveBeenCalledTimes(1)
    },
  )

  it.each(["/plan-usage", "/plan-usage/"])(
    "leaves return handling to the billing page on %s",
    (path) => {
      window.history.replaceState({}, "", `${path}?billing=cancel`)
      const { invalidate } = mount()
      expect(window.location.search).toBe("?billing=cancel")
      expect(invalidate).not.toHaveBeenCalled()
      expect(mocks.toast).not.toHaveBeenCalled()
    },
  )

  it("hides cached data while the team switch is pending", () => {
    mocks.context.mockReturnValue({ teamKey: "use:b", ready: false })
    mocks.payment.mockClear()
    mount()
    expect(screen.queryByRole("status")).not.toBeInTheDocument()
    expect(mocks.payment).not.toHaveBeenCalled()
  })
})

describe("TrialBillingBanner for a new team's trial", () => {
  const trial = (remaining_usd: number, almost_used_up_usd?: number) =>
    summary({
      trial: { state: "active", remaining_usd, almost_used_up_usd },
    })
  const entry = (data: string) =>
    mocks.entry.mockReturnValue({ data, isPending: false, isError: false })
  const banner = () => screen.getByRole("region", { name: "Free trial" })

  it("shows the trial with an Upgrade to the selected plan's checkout", () => {
    entry("trial")
    mocks.offers = [{ offer_key: "developer_monthly", display_name: "Builder" }]
    mocks.summary.mockReturnValue({ data: trial(0.37, 0.11) })
    const { container } = mount("developer")
    expect(banner()).toHaveTextContent("You're on a free trial with $0.37 left")
    const upgrade = screen.getByRole("button", { name: "Upgrade to Builder" })
    const form = upgrade.closest("form")!
    expect(form.getAttribute("method")).toBe("post")
    expect(form.getAttribute("action")).toMatch(
      /^\/api\/onboarding\/checkout\/\?offer=developer$/,
    )
    expect(container.textContent).not.toMatch(/Add Payment|\$95/)
  })

  it("warns once the balance reaches the almost-used-up setting", () => {
    entry("trial")
    mocks.summary.mockReturnValue({ data: trial(0.11, 0.11) })
    mount("pro_monthly")
    expect(banner()).toHaveTextContent(/almost used up: \$0\.11 left/)
    expect(banner()).toHaveClass("bg-yellow-100")
  })

  it("has no almost-used-up stage without the setting", () => {
    entry("trial")
    mocks.summary.mockReturnValue({ data: trial(0.01) })
    mount("pro_monthly")
    expect(banner()).not.toHaveTextContent(/almost used up/)
  })

  it("says sandboxes are paused and nothing is deleted once the trial ends", () => {
    entry("trial_ended")
    mocks.summary.mockReturnValue({ data: trial(0) })
    mount()
    expect(banner()).toHaveTextContent(
      "Your free trial has ended. Your sandboxes are paused and nothing is deleted. Upgrade to resume.",
    )
    expect(banner()).toHaveClass("bg-red-100")
    expect(screen.getByRole("link", { name: "Upgrade" })).toHaveAttribute(
      "href",
      expect.stringMatching(/\/auth\/choose-plan\/?\?reason=upgrade$/),
    )
  })

  it("waits for the entry state instead of flashing the legacy banner", () => {
    mocks.entry.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
    })
    const { container } = mount()
    expect(container.textContent).toBe("")
  })

  it("leaves Upgrade to billing administrators", () => {
    entry("trial")
    mocks.summary.mockReturnValue({
      data: summary({ permissions: { can_view: true, can_manage: false } }),
    })
    mount("developer")
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
    expect(
      screen.getByText("Contact your team's billing administrator."),
    ).toBeInTheDocument()
  })
})

describe("trialStage", () => {
  it.each([
    ["trial", { state: "active", remaining_usd: 0.5 }, "trial"],
    ["trial", { state: "exhausted", remaining_usd: 0.5 }, "ended"],
    ["trial", { state: "active", remaining_usd: 0 }, "ended"],
    ["trial_ended", { state: "active", remaining_usd: 0.5 }, "ended"],
    ["payment_failed", undefined, "payment_failed"],
    ["trial", undefined, "trial"],
  ] as const)("%s with %o is %s", (entry, trial, stage) => {
    expect(trialStage(entry, trial)).toBe(stage)
  })
})
