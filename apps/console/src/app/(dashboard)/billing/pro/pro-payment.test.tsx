import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { proCheckoutPlanSchema } from "@/lib/api/billing-v2"
import { ApiError } from "@/lib/api/client"
import { signInOfferDestination } from "@/lib/auth/signup-offer"
import type { PublicBillingPlans } from "@/lib/billing/plans"

import { ProPayment as ActualProPayment } from "./pro-payment"
function ProPayment(props: React.ComponentProps<typeof ActualProPayment>) {
  if (!state.query && props.billingReturn)
    state.query = `billing=${props.billingReturn}&team=${props.checkoutTeam ?? ""}`
  return <ActualProPayment {...props} />
}

const state = vi.hoisted(() => ({
  team: { teamId: "11111111-1111-4111-8111-111111111111", region: "use" },
  quote: undefined as import("@/lib/api/billing-v2").ProCheckout | undefined,
  actor: "actor",
  teamMutating: false,
  starterRecovery: vi.fn(),
  refresh: vi.fn(),
  quoteError: false,
  quotePending: false,
  retryQuote: vi.fn(),
  planQuery: vi.fn(),
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
  ready: true,
  query: "billing=success&team=use:11111111-1111-4111-8111-111111111111",
  switch: vi.fn(),
  members: false,
  directoryError: false,
  refetch: vi.fn(),
}))

vi.mock("@tanstack/react-query", async (original) => ({
  ...(await original<typeof import("@tanstack/react-query")>()),
  useIsMutating: () => (state.teamMutating ? 1 : 0),
  useQueryClient: () => ({ isMutating: () => (state.teamMutating ? 1 : 0) }),
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: state.replace }),
  useSearchParams: () => new URLSearchParams(state.query),
}))
vi.mock("@/components/query-provider", () => ({
  useDashboardTeamContext: () => state.team,
  useQueryScope: () => state.scope,
}))
vi.mock("@/components/page-header", () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}))
vi.mock("@/hooks/use-billing-context", () => ({
  useBillingContext: () => ({ ready: state.ready }),
}))
vi.mock("@/hooks/use-user", () => ({
  useUser: () => ({ user: { id: state.actor } }),
}))
vi.mock("@/hooks/use-teams", () => ({
  useTeams: () => ({
    data: state.members
      ? {
          teams: [
            { id: "11111111-1111-4111-8111-111111111111", region: "use" },
          ],
        }
      : null,
    isError: state.directoryError,
    refetch: state.refetch,
  }),
  useSwitchTeam: () => ({ mutateAsync: state.switch }),
}))
vi.mock("@/hooks/use-billing-v2", () => ({
  useProCheckoutTerms: (enabled: boolean) => {
    state.planQuery(enabled)
    return {
      data: state.quote,
      isError: state.quoteError,
      isPending: state.quotePending,
      refetch: state.retryQuote,
    }
  },
}))
vi.mock("@/hooks/use-billing-summary", () => ({
  useBillingSummary: () => ({
    data: { ...state.summary, permissions: { can_manage: state.canManage } },
    refetch: state.refresh,
    isPending: false,
    isError: state.summaryError,
  }),
}))
vi.mock("@/hooks/use-public-billing-plans", () => ({
  usePublicBillingPlans: () => ({
    data: state.plans,
    isPending: false,
    refetch: state.refresh,
  }),
}))
vi.mock("@/lib/api/starter-checkout-recovery", () => ({
  recoverStarterCheckout: (...args: unknown[]) =>
    state.starterRecovery(...args),
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
  state.team = { teamId: "11111111-1111-4111-8111-111111111111", region: "use" }
  state.actor = "actor"
  state.teamMutating = false
  state.starterRecovery
    .mockReset()
    .mockResolvedValue({ outcome: "no_pending_starter_checkout" })
  state.refresh.mockReset().mockResolvedValue({ isError: false })
  state.quoteError = false
  state.quotePending = false
  state.retryQuote.mockReset().mockResolvedValue({ isError: false })
  state.quote = undefined
  state.planQuery.mockClear()
  state.recover.mockReset()
  state.resume.mockReset().mockResolvedValue(null)
  state.start.mockReset()
  state.plans = undefined
  state.replace.mockReset()
  state.summary = null
  state.summaryError = false
  state.scope = "self"
  state.canManage = true
  state.ready = true
  state.query = ""
  state.members = false
  state.directoryError = false
  state.switch.mockReset()
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
        "use:11111111-1111-4111-8111-111111111111",
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
      expect(state.resume).toHaveBeenCalledWith(
        "use:11111111-1111-4111-8111-111111111111",
        "actor",
      ),
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
    state.scope = "11111111-1111-4111-8111-111111111111"
    state.plans = availablePlans
    render(
      <ProPayment
        returnTo="/sandboxes"
        billingReturn="success"
        checkoutTeam="use:11111111-1111-4111-8111-111111111111"
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
      state.ready = true
      state.members = false
      state.directoryError = false
      state.switch.mockReset()
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
    expect(
      screen.getByText(/Return to the account and team/).textContent,
    ).toContain("account and team that started checkout")
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
    ).toBe("use:11111111-1111-4111-8111-111111111111")
    state.team = { teamId: "team-b", region: "use" }
    view.rerender(<ProPayment returnTo="/plan-usage/" />)
    expect(
      screen.getByText(/Return to the account and team/).textContent,
    ).toContain("account and team that started checkout")
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
        checkoutTeam="use:11111111-1111-4111-8111-111111111111"
      />,
    )
    await waitFor(() =>
      expect(state.recover).toHaveBeenCalledWith(
        "use:11111111-1111-4111-8111-111111111111",
      ),
    )
    state.team = { teamId: "team-b", region: "use" }
    view.rerender(
      <ProPayment
        billingReturn="success"
        returnTo="/plan-usage/"
        checkoutTeam="use:11111111-1111-4111-8111-111111111111"
      />,
    )
    await act(async () => {
      resolve("active")
    })
    expect(state.replace).not.toHaveBeenCalled()
    expect(
      screen.getByText(/Return to the account and team/).textContent,
    ).toContain("account and team that started checkout")
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
    expect(state.recover).toHaveBeenCalledWith(
      "use:11111111-1111-4111-8111-111111111111",
    )
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
    expect(
      screen.getByText(/Return to the account and team/).textContent,
    ).toContain("account and team that started checkout")
    expect(screen.queryByRole("button", { name: "Check again" })).toBeNull()
    expect(state.recover).toHaveBeenCalledExactlyOnceWith(
      "use:11111111-1111-4111-8111-111111111111",
    )
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
        expect(state.recover).toHaveBeenCalledExactlyOnceWith(
          "use:11111111-1111-4111-8111-111111111111",
        ),
      )
      state.team = { teamId: "team-b", region: "use" }
      view.rerender(<ProPayment returnTo="/plan-usage/" />)
      await screen.findByRole("button", { name: "Check payment status" })
      expect(
        screen.queryByText(/account and team that started checkout/),
      ).toBeNull()
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
    expect(state.recover).toHaveBeenCalledWith(
      "use:11111111-1111-4111-8111-111111111111",
    )
    expect(state.start).not.toHaveBeenCalled()
    expect(
      screen.queryByRole("button", { name: "Continue to payment" }),
    ).toBeNull()
  })
  it("preserves a rejected team-switch error while context is pending and permits retry", async () => {
    state.team = { teamId: "other-team", region: "use" }
    state.members = true
    let reject!: (error: Error) => void
    state.switch.mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail
        }),
    )
    const props = {
      billingReturn: "success" as const,
      returnTo: "/plan-usage/",
      checkoutTeam: "use:11111111-1111-4111-8111-111111111111",
    }
    const view = render(<ProPayment {...props} />)
    fireEvent.click(
      screen.getByRole("button", { name: "Return to checkout team" }),
    )
    state.ready = false
    view.rerender(<ProPayment {...props} />)
    expect(state.recover).not.toHaveBeenCalled()
    expect(state.start).not.toHaveBeenCalled()
    state.ready = true
    view.rerender(<ProPayment {...props} />)
    await act(async () => reject(new Error("not a member")))
    expect(
      screen.getByText("Unable to restore checkout. Please try again."),
    ).toBeTruthy()
    fireEvent.click(
      screen.getByRole("button", { name: "Return to checkout team" }),
    )
    expect(state.switch).toHaveBeenCalledTimes(2)
  })
  it.each([false, true])(
    "offers sign-in recovery for unresolved directory, error=%s",
    (error) => {
      state.ready = false
      state.directoryError = error
      render(
        <ProPayment
          billingReturn="success"
          returnTo="/plan-usage/"
          checkoutTeam="use:11111111-1111-4111-8111-111111111111"
        />,
      )
      expect(
        screen.getByRole("button", {
          name: "Sign out and use checkout account",
        }),
      ).toBeTruthy()
      expect(
        screen.getByRole("button", { name: "Retry team lookup" }),
      ).toBeTruthy()
      expect(state.recover).not.toHaveBeenCalled()
      expect(state.start).not.toHaveBeenCalled()
    },
  )
  it.each([
    "billing=invalid",
    "billing=success&billing=cancel",
    "team=invalid",
  ])(
    "blocks malformed raw callback %s before offering another payment",
    (query) => {
      state.query = query
      state.plans = availablePlans
      render(<ActualProPayment returnTo="/plan-usage/" />)
      expect(screen.getByText(/incomplete or invalid/)).toBeTruthy()
      expect(
        screen.queryByRole("button", { name: "Continue to payment" }),
      ).toBeNull()
      expect(state.start).not.toHaveBeenCalled()
      expect(state.recover).not.toHaveBeenCalled()
    },
  )
})

describe("verified first-cycle route contract", () => {
  it("passes the server candidate to the actual offer without changing checkout target", () => {
    state.quote = { first_paid_pro_cycle: true, accepted: false }
    state.plans = availablePlans
    render(<ActualProPayment returnTo="/plan-usage/" />)
    expect(screen.getByText(/first full month of Pro costs \$250/)).toBeTruthy()
    expect(state.planQuery).toHaveBeenLastCalledWith(true)
    expect(state.start).not.toHaveBeenCalled()
  })
  it("hides another team’s quote and disables its lookup on a retained callback mismatch", () => {
    state.quote = {
      first_paid_pro_cycle: true,
      accepted: true,
      first_payment_cents: 12345,
      first_credit_cents: 67890,
    }
    state.query =
      "billing=success&team=usw:22222222-2222-4222-8222-222222222222"
    render(
      <ActualProPayment
        billingReturn="success"
        checkoutTeam="usw:22222222-2222-4222-8222-222222222222"
        returnTo="/plan-usage/"
      />,
    )
    expect(
      screen.getByRole("button", { name: "Sign out and use checkout account" }),
    ).toBeTruthy()
    expect(screen.queryByText(/123.45|678.90/)).toBeNull()
    expect(state.planQuery).toHaveBeenLastCalledWith(false)
    expect(state.start).not.toHaveBeenCalled()
    expect(state.recover).not.toHaveBeenCalled()
  })
})

it("does not offer incorrect old-backend terms after the quote request fails", () => {
  state.quoteError = true
  state.plans = availablePlans
  render(<ActualProPayment returnTo="/plan-usage/" />)
  expect(
    screen.getByText(/couldn’t load your first-payment terms/),
  ).toBeTruthy()
  expect(screen.queryByText(/prorated non-expiring/)).toBeNull()
  expect(
    screen
      .getByRole("button", { name: "Continue to payment" })
      .hasAttribute("disabled"),
  ).toBe(true)
  fireEvent.click(screen.getByRole("button", { name: "Retry payment terms" }))
  expect(state.retryQuote).toHaveBeenCalledOnce()
  expect(state.start).not.toHaveBeenCalled()
})
it("does not wait forever for a disabled non-self plan query", () => {
  state.scope = "other-team"
  state.quotePending = true
  state.summary = { plan: { key: "pro", name: "Pro", status: "active" } }
  render(<ActualProPayment returnTo="/plan-usage/" />)
  expect(screen.queryByText("Loading Pro…")).toBeNull()
  expect(screen.getByText(/Your team is on Pro/)).toBeTruthy()
  expect(state.planQuery).toHaveBeenLastCalledWith(false)
})

const pendingCredit = {
  purchase_id: "33333333-3333-4333-8333-333333333333",
  checkout_generation: "2026-10-26T12:00:00.123456789Z",
  amount_cents: 2500,
}
async function discoverCredit() {
  state.recover.mockResolvedValue("no_pending_pro_purchase")
  state.starterRecovery.mockResolvedValue({
    ...pendingCredit,
    outcome: "pending_starter_checkout",
  })
  const view = render(<ActualProPayment returnTo="/plan-usage/" />)
  fireEvent.click(screen.getByRole("button", { name: "Check payment status" }))
  await screen.findByRole("button", { name: "Resume your $25 credit purchase" })
  return view
}
describe("pending Starter while choosing Pro", () => {
  it("discovers without redirect and only resumes the explicitly selected existing purchase", async () => {
    const assign = vi
      .spyOn(window.location, "assign")
      .mockImplementation(() => {})
    await discoverCredit()
    expect(state.starterRecovery).toHaveBeenCalledExactlyOnceWith(
      "use:11111111-1111-4111-8111-111111111111",
    )
    expect(assign).not.toHaveBeenCalled()
    expect(state.start).not.toHaveBeenCalled()
    state.starterRecovery.mockResolvedValue({
      ...pendingCredit,
      outcome: "recovered",
      url: "https://checkout.stripe.com/original",
    })
    fireEvent.click(
      screen.getByRole("button", { name: "Resume your $25 credit purchase" }),
    )
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith(
        "https://checkout.stripe.com/original",
      ),
    )
    expect(state.starterRecovery).toHaveBeenLastCalledWith(
      "use:11111111-1111-4111-8111-111111111111",
      expect.objectContaining(pendingCredit),
      false,
    )
    expect(state.start).not.toHaveBeenCalled()
    assign.mockRestore()
  })
  it("cancels only after explicit action and refreshes all authoritative offers before showing Pro", async () => {
    state.plans = undefined
    await discoverCredit()
    state.plans = availablePlans
    state.starterRecovery.mockResolvedValue({
      ...pendingCredit,
      outcome: "retryable",
    })
    fireEvent.click(
      screen.getByRole("button", {
        name: "Cancel this purchase and choose Pro",
      }),
    )
    await screen.findByRole("button", { name: "Continue to payment" })
    expect(state.starterRecovery).toHaveBeenLastCalledWith(
      "use:11111111-1111-4111-8111-111111111111",
      expect.objectContaining(pendingCredit),
      true,
    )
    expect(state.retryQuote).toHaveBeenCalledOnce()
    expect(state.refresh).toHaveBeenCalledTimes(2)
    expect(state.start).not.toHaveBeenCalled()
  })
  it.each(["payment_confirmation_pending", "network"])(
    "keeps the purchase fenced for %s cancellation outcome",
    async (outcome) => {
      await discoverCredit()
      if (outcome === "network")
        state.starterRecovery.mockRejectedValue(
          new Error("lost acknowledgement"),
        )
      else state.starterRecovery.mockResolvedValue({ outcome })
      fireEvent.click(
        screen.getByRole("button", {
          name: "Cancel this purchase and choose Pro",
        }),
      )
      await screen.findByRole("alert")
      expect(
        screen.getByRole("button", { name: "Resume your $25 credit purchase" }),
      ).toBeTruthy()
      expect(
        screen.queryByRole("button", { name: "Continue to payment" }),
      ).toBeNull()
      expect(state.refresh).not.toHaveBeenCalled()
      expect(state.start).not.toHaveBeenCalled()
    },
  )
  it("fails closed when the older endpoint is missing", async () => {
    state.recover.mockResolvedValue("no_pending_pro_purchase")
    state.starterRecovery.mockRejectedValue(
      new ApiError(404, "not_found", "Recovery unavailable"),
    )
    render(<ActualProPayment returnTo="/plan-usage/" />)
    fireEvent.click(
      screen.getByRole("button", { name: "Check payment status" }),
    )
    await screen.findByText("Recovery unavailable")
    expect(
      screen.queryByRole("button", { name: "Continue to payment" }),
    ).toBeNull()
    expect(state.start).not.toHaveBeenCalled()
  })
  it("ignores a late discovered purchase after switching actor", async () => {
    let finish!: (result: unknown) => void
    state.recover.mockResolvedValue("no_pending_pro_purchase")
    state.starterRecovery.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const view = render(<ActualProPayment returnTo="/plan-usage/" />)
    fireEvent.click(
      screen.getByRole("button", { name: "Check payment status" }),
    )
    await waitFor(() => expect(state.starterRecovery).toHaveBeenCalledOnce())
    state.actor = "different-actor"
    view.rerender(<ActualProPayment returnTo="/plan-usage/" />)
    await act(async () =>
      finish({ ...pendingCredit, outcome: "pending_starter_checkout" }),
    )
    expect(
      screen.queryByRole("button", { name: "Resume your $25 credit purchase" }),
    ).toBeNull()
    expect(state.start).not.toHaveBeenCalled()
  })
  it("hides discovered credit and prevents cancellation for another actor", async () => {
    const view = await discoverCredit()
    state.actor = "different-actor"
    view.rerender(<ActualProPayment returnTo="/plan-usage/" />)
    expect(screen.queryByText(/\$25/)).toBeNull()
    expect(
      screen.getByRole("button", { name: "Sign out and use checkout account" }),
    ).toBeTruthy()
    expect(state.starterRecovery).toHaveBeenCalledTimes(1)
  })
  it("blocks recovery actions while a sidebar team mutation is pending", async () => {
    const view = await discoverCredit()
    state.teamMutating = true
    view.rerender(<ActualProPayment returnTo="/plan-usage/" />)
    const cancel = screen.getByRole("button", {
      name: "Cancel this purchase and choose Pro",
    })
    expect(cancel.hasAttribute("disabled")).toBe(true)
    fireEvent.click(cancel)
    expect(state.starterRecovery).toHaveBeenCalledTimes(1)
  })
  it("does not allow a new Pro checkout when refresh after cancellation fails", async () => {
    await discoverCredit()
    state.starterRecovery.mockResolvedValue({
      ...pendingCredit,
      outcome: "retryable",
    })
    state.retryQuote.mockResolvedValue({ isError: true })
    fireEvent.click(
      screen.getByRole("button", {
        name: "Cancel this purchase and choose Pro",
      }),
    )
    await screen.findByText(/Unable to refresh your plan/)
    expect(
      screen.queryByRole("button", { name: "Continue to payment" }),
    ).toBeNull()
    expect(state.start).not.toHaveBeenCalled()
  })
})

it("can rediscover released purchase after a failed post-cancellation refresh", async () => {
  await discoverCredit()
  state.starterRecovery.mockResolvedValue({
    ...pendingCredit,
    outcome: "retryable",
  })
  state.retryQuote.mockResolvedValue({ isError: true })
  fireEvent.click(
    screen.getByRole("button", { name: "Cancel this purchase and choose Pro" }),
  )
  await screen.findByText(/Unable to refresh your plan/)
  state.retryQuote.mockResolvedValue({ isError: false })
  state.starterRecovery.mockResolvedValue({
    outcome: "no_pending_starter_checkout",
  })
  state.plans = availablePlans
  fireEvent.click(screen.getByRole("button", { name: "Check purchase status" }))
  await screen.findByRole("button", { name: "Continue to payment" })
  expect(state.start).not.toHaveBeenCalled()
})

it("shows only frozen first terms on an actual accepted cancel return with a changed catalog", async () => {
  const originalTeam = "use:11111111-1111-4111-8111-111111111111"
  state.query = `billing=cancel&team=${originalTeam}`
  state.quote = {
    first_paid_pro_cycle: true,
    accepted: true,
    first_payment_cents: 25000,
    first_credit_cents: 40000,
    period_start: "2026-10-26T12:00:00Z",
    period_end: "2026-11-26T12:00:00Z",
    credit_expires_at: "2026-11-26T12:00:00Z",
  }
  const card = availablePlans.cards[0]!
  state.plans = {
    ...availablePlans,
    cards: [
      {
        ...card,
        name: "Changed catalog Pro",
        monthly: { ...card.monthly!, price_cents: 17500 },
        monthly_credit_cents: 32000,
        credit_summary: "$320 every month",
        features: ["New catalog entitlement"],
        limits: { ...card.limits, max_concurrent: 9999 },
      },
    ],
  }
  render(
    <ActualProPayment
      billingReturn="cancel"
      checkoutTeam={originalTeam}
      returnTo="/plan-usage/"
    />,
  )
  expect(
    screen.getByText(/First payment: \$250 before any promotion discount/),
  ).toBeTruthy()
  expect(screen.getByText(/Included usage credit: \$400/)).toBeTruthy()
  expect(screen.getByText(/credit expires Nov 26, 2026/)).toBeTruthy()
  expect(
    screen.queryByText(
      /175|320|9,999|Changed catalog Pro|New catalog entitlement/,
    ),
  ).toBeNull()
  expect(screen.queryByText(/monthly fee|running at once/)).toBeNull()
  expect(
    screen.queryByRole("button", { name: "Continue to payment" }),
  ).toBeNull()
  expect(state.start).not.toHaveBeenCalled()
  state.recover.mockResolvedValue("payment_confirmation_pending")
  state.resume.mockResolvedValue("https://checkout.stripe.com/original")
  const assign = vi
    .spyOn(window.location, "assign")
    .mockImplementation(() => {})
  fireEvent.click(
    screen.getByRole("button", { name: "Continue saved checkout" }),
  )
  await waitFor(() =>
    expect(assign).toHaveBeenCalledWith("https://checkout.stripe.com/original"),
  )
  expect(state.resume).toHaveBeenCalledWith(originalTeam, "actor")
  expect(state.start).not.toHaveBeenCalled()
  assign.mockRestore()
})

const noAssignmentPlan = {
  plan: null,
  period: { start: "2026-10-26T00:00:00Z", end: "2026-11-01T00:00:00Z" },
  pending_change: null,
}
it("renders parsed server first-cycle terms when the current plan assignment is null", () => {
  state.quote =
    proCheckoutPlanSchema.parse({
      ...noAssignmentPlan,
      pro_checkout: { first_paid_pro_cycle: true, accepted: false },
    }) ?? undefined
  state.plans = availablePlans
  render(<ActualProPayment returnTo="/plan-usage/" />)
  expect(screen.getByText(/first full month of Pro costs \$250/)).toBeTruthy()
  expect(
    screen.getByText(/expires at the end of that billing month/),
  ).toBeTruthy()
  expect(screen.queryByText(/prorated non-expiring/)).toBeNull()
  expect(state.start).not.toHaveBeenCalled()
})
it("renders only a parsed frozen quote on a no-assignment cancel return", () => {
  const team = "use:11111111-1111-4111-8111-111111111111"
  state.quote =
    proCheckoutPlanSchema.parse({
      ...noAssignmentPlan,
      pro_checkout: {
        first_paid_pro_cycle: true,
        accepted: true,
        first_payment_cents: 25000,
        first_credit_cents: 40000,
        period_start: "2026-10-26T12:00:00Z",
        period_end: "2026-11-26T12:00:00Z",
        credit_expires_at: "2026-11-26T12:00:00Z",
      },
    }) ?? undefined
  state.plans = availablePlans
  state.query = `billing=cancel&team=${team}`
  render(
    <ActualProPayment
      billingReturn="cancel"
      checkoutTeam={team}
      returnTo="/plan-usage/"
    />,
  )
  expect(screen.getByText(/First payment: \$250/)).toBeTruthy()
  expect(screen.getByText(/Included usage credit: \$400/)).toBeTruthy()
  expect(screen.queryByText(/prorated non-expiring/)).toBeNull()
  expect(
    screen.queryByRole("button", { name: "Continue to payment" }),
  ).toBeNull()
  expect(state.start).not.toHaveBeenCalled()
})
it("keeps successful legacy missing-quote behavior with no assignment", () => {
  state.quote = proCheckoutPlanSchema.parse(noAssignmentPlan) ?? undefined
  state.plans = availablePlans
  render(<ActualProPayment returnTo="/plan-usage/" />)
  expect(screen.getByText(/prorated non-expiring/)).toBeTruthy()
  expect(
    screen.getByRole("button", { name: "Continue to payment" }),
  ).toBeTruthy()
})

describe("terminal Pro recovery to Starter fence transition", () => {
  it("discovers a pending Starter purchase after a retryable Pro operation without offering a new checkout", async () => {
    state.plans = availablePlans
    state.recover.mockResolvedValue("retryable")
    state.starterRecovery.mockResolvedValue({
      ...pendingCredit,
      outcome: "pending_starter_checkout",
    })
    render(<ActualProPayment returnTo="/plan-usage/" />)
    fireEvent.click(screen.getByRole("button", { name: "Continue to payment" }))
    await screen.findByRole("button", { name: "Check again" })
    fireEvent.click(screen.getByRole("button", { name: "Check again" }))
    await screen.findByRole("button", {
      name: "Resume your $25 credit purchase",
    })
    expect(state.starterRecovery).toHaveBeenCalledExactlyOnceWith(
      "use:11111111-1111-4111-8111-111111111111",
    )
    expect(
      screen.queryByRole("button", { name: "Continue to payment" }),
    ).toBeNull()
    expect(state.start).toHaveBeenCalledTimes(1)
    expect(state.refresh).not.toHaveBeenCalled()
    expect(state.starterRecovery.mock.calls[0]).toHaveLength(1)
  })
  it.each(["retryable", "no_pending_pro_purchase"])(
    "requires a successful Starter discovery and authoritative refresh after %s",
    async (outcome) => {
      state.recover.mockResolvedValue(outcome)
      state.starterRecovery.mockResolvedValue({
        outcome: "no_pending_starter_checkout",
      })
      render(<ActualProPayment returnTo="/plan-usage/" />)
      fireEvent.click(
        screen.getByRole("button", { name: "Check payment status" }),
      )
      await waitFor(() => expect(state.retryQuote).toHaveBeenCalledOnce())
      expect(state.refresh).toHaveBeenCalledTimes(2)
      expect(state.start).not.toHaveBeenCalled()
    },
  )
  it.each(["active", "payment_confirmation_pending"])(
    "does not discover or cancel Starter while Pro is %s",
    async (outcome) => {
      state.recover.mockResolvedValue(outcome)
      render(<ActualProPayment returnTo="/plan-usage/" />)
      fireEvent.click(
        screen.getByRole("button", { name: "Check payment status" }),
      )
      if (outcome === "active")
        await waitFor(() =>
          expect(state.replace).toHaveBeenCalledWith("/plan-usage/"),
        )
      else await screen.findByRole("button", { name: "Check again" })
      expect(state.starterRecovery).not.toHaveBeenCalled()
      expect(
        screen.queryByRole("button", {
          name: "Cancel this purchase and choose Pro",
        }),
      ).toBeNull()
      expect(
        screen.queryByRole("button", { name: "Continue to payment" }),
      ).toBeNull()
      expect(state.start).not.toHaveBeenCalled()
    },
  )
})
