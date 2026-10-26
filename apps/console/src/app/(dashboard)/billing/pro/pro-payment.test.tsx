import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "@/lib/api/client"
import { signInOfferDestination } from "@/lib/auth/signup-offer"
import type { PublicBillingPlans } from "@/lib/billing/plans"

import { ProPayment } from "./pro-payment"

const state = vi.hoisted(() => ({
  team: { teamId: "team-a", region: "use" },
  recover: vi.fn(),
  resume: vi.fn(),
  start: vi.fn(),
  plans: undefined as PublicBillingPlans | undefined,
  replace: vi.fn(),
  summary: null as null | {
    plan: { key: string; name: string; status: string }
  },
  summaryError: false,
  scope: "self",
  canManage: true,
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: state.replace }),
}))
vi.mock("@/components/query-provider", () => ({
  useDashboardTeamContext: () => state.team,
  useQueryScope: () => state.scope,
}))
vi.mock("@/components/page-header", () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}))
vi.mock("@/hooks/use-user", () => ({
  useUser: () => ({ user: { id: "actor" } }),
}))
vi.mock("@/hooks/use-teams", () => ({ useTeams: () => ({ data: null }) }))
vi.mock("@/hooks/use-billing-summary", () => ({
  useBillingSummary: () => ({
    data: { ...state.summary, permissions: { can_manage: state.canManage } },
    isPending: false,
    isError: state.summaryError,
  }),
}))
vi.mock("@/hooks/use-public-billing-plans", () => ({
  usePublicBillingPlans: () => ({ data: state.plans, isPending: false }),
}))
vi.mock("@/lib/api/plan-checkout", () => ({
  recoverProPayment: (...args: unknown[]) => state.recover(...args),
  resumeProCheckout: (...args: unknown[]) => state.resume(...args),
  startProCheckout: (...args: unknown[]) => state.start(...args),
  isStripeCheckoutUrl: (value: string) =>
    value.startsWith("https://checkout.stripe.com/"),
}))

const availablePlans: PublicBillingPlans = {
  pricing_version: "v2",
  cards: [
    {
      family: "pro",
      version: 1,
      kind: "subscription",
      name: "Pro",
      price_label: "$250/month",
      tagline: "",
      features: [],
      display_only: false,
      monthly: {
        offer_key: "pro_monthly",
        price_cents: 25000,
        monthly_equivalent_cents: 25000,
        available: true,
      },
      annual: null,
      credit_summary: "$250 every month",
      monthly_credit_cents: 25000,
      allowance: null,
      matching: null,
      limits: {
        max_concurrent: 1000,
        max_vcpu: 8,
        max_memory_mib: 32768,
        max_disk_mib: 102400,
        max_templates: null,
      },
    },
  ],
}

beforeEach(() => {
  state.team = { teamId: "team-a", region: "use" }
  state.recover.mockReset()
  state.resume.mockReset().mockResolvedValue(null)
  state.start.mockReset()
  state.plans = undefined
  state.replace.mockReset()
  state.summary = null
  state.summaryError = false
  state.scope = "self"
  state.canManage = true
})

describe("Pro payment return recovery", () => {
  it("normalizes the annual website alias to the visible monthly v2 offer and submits that quote", async () => {
    expect(signInOfferDestination("pro_annual")).toBe("/billing/pro/")
    state.plans = availablePlans
    state.start.mockResolvedValue(undefined)
    render(<ProPayment returnTo="/sandboxes" />)
    expect(screen.getByText("$250")).toBeTruthy()
    expect(screen.getByText("/ month")).toBeTruthy()
    expect(screen.getByText(/Your regular \$250 monthly fee/)).toBeTruthy()
    expect(screen.queryByText(/year|annual/i)).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Continue to payment" }))
    await waitFor(() =>
      expect(state.start).toHaveBeenCalledWith(
        "use:team-a",
        "pro_monthly",
        expect.any(String),
        "actor",
      ),
    )
  })

  it("reopens an accepted checkout after a lost first response even when entry closes", async () => {
    state.plans = availablePlans
    state.start.mockRejectedValueOnce(new Error("lost response"))
    state.recover.mockResolvedValue("payment_confirmation_pending")
    state.resume.mockResolvedValue("https://checkout.stripe.com/original")
    const assign = vi
      .spyOn(window.location, "assign")
      .mockImplementation(() => {})
    const { rerender } = render(<ProPayment returnTo="/original" />)
    fireEvent.click(screen.getByRole("button", { name: "Continue to payment" }))
    await screen.findByText("lost response")
    state.plans = { ...availablePlans, pricing_version: "legacy" }
    rerender(<ProPayment returnTo="/different-return" />)
    fireEvent.click(
      screen.getByRole("button", { name: "Check payment status" }),
    )
    await waitFor(() =>
      expect(state.resume).toHaveBeenCalledWith("use:team-a", "actor"),
    )
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith(
        "https://checkout.stripe.com/original",
      ),
    )
    // URL validation is separate from payment state; navigation grants no plan.
    expect(state.start).toHaveBeenCalledTimes(1)
    assign.mockRestore()
  })

  it.each(["v2", "legacy"] as const)(
    "preserves a legacy annual contract's name and closes new checkout under %s entry",
    (version) => {
      state.summary = {
        plan: {
          key: "pro_annual",
          name: "Legacy Annual Agreement",
          status: "active",
        },
      }
      state.plans = { ...availablePlans, pricing_version: version }
      render(<ProPayment returnTo="/sandboxes" />)
      expect(
        screen.getByText(/Your team is on Legacy Annual Agreement/),
      ).toBeTruthy()
      expect(
        screen.queryByRole("button", { name: "Continue to payment" }),
      ).toBeNull()
      expect(state.start).not.toHaveBeenCalled()
    },
  )

  it("keeps payment disabled for members without billing permission", () => {
    state.canManage = false
    state.plans = availablePlans
    render(<ProPayment returnTo="/sandboxes" />)
    expect(
      screen.getByRole("button", { name: "Continue to payment" }),
    ).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: "Continue to payment" }))
    expect(state.start).not.toHaveBeenCalled()
  })
  it("doesn't recover or start payments while impersonating", () => {
    state.scope = "team-a"
    state.plans = availablePlans
    render(
      <ProPayment
        returnTo="/sandboxes"
        billingReturn="success"
        checkoutTeam="use:team-a"
      />,
    )
    expect(state.recover).not.toHaveBeenCalled()
    expect(state.start).not.toHaveBeenCalled()
  })

  it.each(["legacy", "v2"] as const)(
    "stops claiming an active subscription and closes new entry after a summary error with %s pricing",
    (version) => {
      state.summary = {
        plan: { key: "pro_monthly", name: "Pro", status: "active" },
      }
      state.plans =
        version === "v2"
          ? availablePlans
          : { pricing_version: "legacy", cards: [] }
      const view = render(<ProPayment returnTo="/plan-usage/" />)
      expect(screen.getByText(/Your team is on Pro/)).toBeTruthy()
      state.summaryError = true
      view.rerender(<ProPayment returnTo="/plan-usage/" />)
      expect(screen.queryByText(/Your team is on Pro/)).toBeNull()
      expect(
        screen.getByText("Pro isn’t available to buy here right now."),
      ).toBeTruthy()
      expect(
        screen.queryByRole("button", { name: "Continue to payment" }),
      ).toBeNull()
      expect(state.start).not.toHaveBeenCalled()
      expect(state.recover).not.toHaveBeenCalled()
      state.summaryError = false
      state.scope = "self"
      state.canManage = true
      view.rerender(<ProPayment returnTo="/plan-usage/" />)
      expect(screen.getByText(/Your team is on Pro/)).toBeTruthy()
    },
  )

  it("requires the original checkout team before recovering", () => {
    render(
      <ProPayment
        billingReturn="success"
        returnTo="/plan-usage/"
        checkoutTeam="use:team-b"
      />,
    )
    expect(screen.getByRole("alert").textContent).toContain(
      "team you used for checkout",
    )
    expect(state.recover).not.toHaveBeenCalled()
  })

  it("pins in-page pending recovery to the team that started checkout", async () => {
    state.plans = availablePlans
    state.start.mockResolvedValue(null)
    const view = render(<ProPayment returnTo="/plan-usage/" />)
    fireEvent.click(screen.getByRole("button", { name: "Continue to payment" }))
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Check again" })).toBeTruthy(),
    )
    expect(
      new URL(state.start.mock.calls[0]![2]).searchParams.get("team"),
    ).toBe("use:team-a")
    state.team = { teamId: "team-b", region: "use" }
    view.rerender(<ProPayment returnTo="/plan-usage/" />)
    expect(screen.getByRole("alert").textContent).toContain(
      "team you used for checkout",
    )
    expect(state.recover).not.toHaveBeenCalled()
  })

  it("ignores recovery results after the active team changes", async () => {
    let resolve!: (outcome: string) => void
    state.recover.mockReturnValue(
      new Promise<string>((done) => {
        resolve = done
      }),
    )
    const view = render(
      <ProPayment
        billingReturn="success"
        returnTo="/plan-usage/"
        checkoutTeam="use:team-a"
      />,
    )
    await waitFor(() =>
      expect(state.recover).toHaveBeenCalledWith("use:team-a"),
    )
    state.team = { teamId: "team-b", region: "use" }
    view.rerender(
      <ProPayment
        billingReturn="success"
        returnTo="/plan-usage/"
        checkoutTeam="use:team-a"
      />,
    )
    await act(async () => {
      resolve("active")
    })
    expect(state.replace).not.toHaveBeenCalled()
    expect(screen.getByRole("alert").textContent).toContain(
      "team you used for checkout",
    )
  })
  it("recovers an expired checkout conflict before offering a new payment", async () => {
    state.plans = availablePlans
    state.start.mockRejectedValue(
      new ApiError(409, "plan_conflict", "Earlier checkout requires recovery"),
    )
    state.recover.mockResolvedValue("retryable")
    render(<ProPayment returnTo="/plan-usage/" />)
    fireEvent.click(screen.getByRole("button", { name: "Continue to payment" }))
    await screen.findByText(
      "This team already has a paid plan or a payment in progress.",
    )
    fireEvent.click(
      screen.getByRole("button", { name: "Check payment status" }),
    )
    await screen.findByRole("button", { name: "Continue to payment" })
    expect(state.recover).toHaveBeenCalledWith("use:team-a")
    expect(state.start).toHaveBeenCalledOnce()
  })

  it("keeps manual pending recovery bound to its original team", async () => {
    state.plans = { ...availablePlans, pricing_version: "legacy" }
    state.recover.mockResolvedValue("payment_confirmation_pending")
    const view = render(<ProPayment returnTo="/plan-usage/" />)
    fireEvent.click(
      screen.getByRole("button", { name: "Check payment status" }),
    )
    await screen.findByRole("button", { name: "Check again" })
    state.team = { teamId: "team-b", region: "use" }
    view.rerender(<ProPayment returnTo="/plan-usage/" />)
    expect(screen.getByRole("alert").textContent).toContain(
      "team you used for checkout",
    )
    expect(screen.queryByRole("button", { name: "Check again" })).toBeNull()
    expect(state.recover).toHaveBeenCalledExactlyOnceWith("use:team-a")
    expect(state.replace).not.toHaveBeenCalled()
  })

  it.each(["retryable", "no_pending_pro_purchase"])(
    "releases the team after a manual %s recovery",
    async (outcome) => {
      state.plans = { ...availablePlans, pricing_version: "legacy" }
      state.recover.mockResolvedValue(outcome)
      const view = render(<ProPayment returnTo="/plan-usage/" />)
      fireEvent.click(
        screen.getByRole("button", { name: "Check payment status" }),
      )
      await waitFor(() =>
        expect(state.recover).toHaveBeenCalledExactlyOnceWith("use:team-a"),
      )
      state.team = { teamId: "team-b", region: "use" }
      view.rerender(<ProPayment returnTo="/plan-usage/" />)
      await screen.findByRole("button", { name: "Check payment status" })
      expect(screen.queryByText(/team you used for checkout/)).toBeNull()
    },
  )

  it("checks an accepted payment after entry closes without opening a new checkout", async () => {
    state.plans = { ...availablePlans, pricing_version: "legacy" }
    state.recover.mockResolvedValue("payment_confirmation_pending")
    render(<ProPayment returnTo="/plan-usage/" />)
    fireEvent.click(
      screen.getByRole("button", { name: "Check payment status" }),
    )
    await screen.findByRole("button", { name: "Check again" })
    expect(state.recover).toHaveBeenCalledWith("use:team-a")
    expect(state.start).not.toHaveBeenCalled()
    expect(
      screen.queryByRole("button", { name: "Continue to payment" }),
    ).toBeNull()
  })
})
