import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

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
  terms: undefined as unknown,
  termsError: false,
  termsFetching: false,
  actor: "actor",
  termsQuery: vi.fn(),
  team: { teamId: "11111111-1111-4111-8111-111111111111", region: "use" },
  recover: vi.fn(),
  resume: vi.fn(),
  start: vi.fn(),
  starterRecover: vi.fn(),
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
  useIsMutating: () => 0,
  useQuery: (options: unknown) => {
    state.termsQuery(options)
    return {
      data: state.terms,
      isError: state.termsError,
      isFetching: state.termsFetching,
    }
  },
  useQueryClient: () => ({ isMutating: () => 0 }),
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: state.replace }),
  useSearchParams: () => new URLSearchParams(state.query),
}))

vi.mock("@/lib/api/starter-checkout-recovery", () => ({
  recoverStarterCheckout: (...args: unknown[]) => state.starterRecover(...args),
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
vi.mock("@/hooks/use-billing-summary", () => ({
  useBillingSummary: () => ({
    data: { ...state.summary, permissions: { can_manage: state.canManage } },
    isPending: false,
    refetch: async () => ({ isError: state.summaryError }),
    isError: state.summaryError,
  }),
}))
vi.mock("@/hooks/use-public-billing-plans", () => ({
  usePublicBillingPlans: () => ({
    data: state.plans,
    isPending: false,
    refetch: async () => ({ isError: false }),
  }),
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

async function readyContinue() {
  const button = await screen.findByRole("button", {
    name: "Continue to payment",
  })
  await waitFor(() => expect(button).not.toBeDisabled())
  return button
}
beforeEach(() => {
  state.terms = undefined
  state.termsError = false
  state.termsFetching = false
  state.actor = "actor"
  state.termsQuery.mockClear()
  state.starterRecover
    .mockReset()
    .mockResolvedValue({ outcome: "no_pending_starter_checkout" })
  state.team = { teamId: "11111111-1111-4111-8111-111111111111", region: "use" }
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
    expect(
      screen.getByText(
        /secure payment page confirms your initial payment amount/,
      ),
    ).toBeTruthy()
    expect(screen.queryByText(/year|annual/i)).toBeNull()
    fireEvent.click(await readyContinue())
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
    fireEvent.click(await readyContinue())
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
    fireEvent.click(await readyContinue())
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
    fireEvent.click(await readyContinue())
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

const pendingStarter = {
  purchase_id: "22222222-2222-4222-8222-222222222222",
  checkout_generation: "2026-10-26T12:00:00Z",
  amount_cents: 2500,
}
async function showPendingStarter() {
  state.plans = availablePlans
  state.start.mockRejectedValue(
    new ApiError(409, "plan_conflict", "Earlier checkout"),
  )
  state.recover.mockResolvedValue("no_pending_pro_purchase")
  state.starterRecover
    .mockResolvedValueOnce({ outcome: "no_pending_starter_checkout" })
    .mockResolvedValue({
      ...pendingStarter,
      outcome: "pending_starter_checkout",
    })
  render(<ProPayment returnTo="/plan-usage/" />)
  fireEvent.click(await readyContinue())
  await screen.findByText(
    "This team already has a paid plan or a payment in progress.",
  )
  fireEvent.click(
    await screen.findByRole("button", { name: "Check payment status" }),
  )
  await screen.findByRole("button", { name: "Resume your $25 credit purchase" })
}

describe("original Starter checkout recovery", () => {
  it("resumes only the discovered original purchase without starting a new payment", async () => {
    await showPendingStarter()
    state.starterRecover.mockResolvedValue({
      ...pendingStarter,
      outcome: "recovered",
      url: "https://checkout.stripe.com/original",
    })
    const assign = vi
      .spyOn(window.location, "assign")
      .mockImplementation(() => {})
    fireEvent.click(
      screen.getByRole("button", { name: "Resume your $25 credit purchase" }),
    )
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith(
        "https://checkout.stripe.com/original",
      ),
    )
    expect(state.starterRecover).toHaveBeenLastCalledWith(
      "use:11111111-1111-4111-8111-111111111111",
      expect.objectContaining(pendingStarter),
      false,
    )
    expect(state.start).toHaveBeenCalledTimes(1)
    assign.mockRestore()
  })
  it("refreshes authoritative state after an explicit verified cancellation", async () => {
    await showPendingStarter()
    state.starterRecover.mockResolvedValue({
      ...pendingStarter,
      outcome: "retryable",
    })
    fireEvent.click(
      screen.getByRole("button", {
        name: "Cancel this purchase and choose Pro",
      }),
    )
    await screen.findByRole("button", { name: "Continue to payment" })
    expect(state.starterRecover).toHaveBeenCalledWith(
      "use:11111111-1111-4111-8111-111111111111",
      expect.objectContaining(pendingStarter),
      true,
    )
    expect(state.start).toHaveBeenCalledTimes(1)
  })
  it("converges after an asynchronous cancellation without expiring or submitting twice", async () => {
    await showPendingStarter()
    state.starterRecover
      .mockResolvedValueOnce({ outcome: "payment_confirmation_pending" })
      .mockResolvedValue({ outcome: "no_pending_starter_checkout" })
    fireEvent.click(
      screen.getByRole("button", {
        name: "Cancel this purchase and choose Pro",
      }),
    )
    await screen.findByRole(
      "button",
      { name: "Continue to payment" },
      { timeout: 3000 },
    )
    expect(
      state.starterRecover.mock.calls.filter((call) => call[2] === true),
    ).toHaveLength(1)
    expect(state.starterRecover).toHaveBeenLastCalledWith(
      "use:11111111-1111-4111-8111-111111111111",
    )
    expect(state.start).toHaveBeenCalledTimes(1)
  })
})

it("discovers a server-side $5 purchase on ordinary Pro entry without attempting a Pro payment", async () => {
  sessionStorage.clear()
  state.query = ""
  state.plans = availablePlans
  state.starterRecover.mockResolvedValue({
    ...pendingStarter,
    amount_cents: 500,
    outcome: "pending_starter_checkout",
  })
  render(<ProPayment returnTo="/plan-usage/" />)
  await screen.findByRole("button", { name: "Resume your $5 credit purchase" })
  expect(
    screen.getByRole("button", { name: "Cancel this purchase and choose Pro" }),
  ).not.toBeDisabled()
  expect(state.start).not.toHaveBeenCalled()
  expect(state.recover).not.toHaveBeenCalled()
  expect(state.resume).not.toHaveBeenCalled()
  expect(state.starterRecover).toHaveBeenCalledExactlyOnceWith(
    "use:11111111-1111-4111-8111-111111111111",
  )
  expect(sessionStorage.length).toBe(0)
})

it.each(["unavailable", "available"])(
  "keeps original Pro status/replay reachable when Starter discovery fails and offer is %s",
  async (offer) => {
    sessionStorage.clear()
    state.plans = offer === "available" ? availablePlans : undefined
    state.starterRecover.mockRejectedValue(
      new Error("HTTP 500: not a Starter checkout"),
    )
    state.recover.mockResolvedValue("payment_confirmation_pending")
    state.resume.mockResolvedValue(
      "https://checkout.stripe.com/original-legacy-pro",
    )
    const assign = vi
      .spyOn(window.location, "assign")
      .mockImplementation(() => {})
    render(<ProPayment returnTo="/plan-usage/" />)
    await screen.findByText(/Unable to check your existing purchase/)
    expect(state.recover).not.toHaveBeenCalled()
    expect(state.start).not.toHaveBeenCalled()
    fireEvent.click(
      screen.getByRole("button", { name: "Check Pro payment status" }),
    )
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith(
        "https://checkout.stripe.com/original-legacy-pro",
      ),
    )
    expect(state.recover).toHaveBeenCalledExactlyOnceWith(
      "use:11111111-1111-4111-8111-111111111111",
    )
    expect(state.start).not.toHaveBeenCalled()
    expect(
      state.starterRecover.mock.calls.every((args) => args.length === 1),
    ).toBe(true)
    assign.mockRestore()
  },
)

it("keeps a known non-Starter Pro checkout's ordinary status control without starting another checkout", async () => {
  state.plans = undefined
  state.starterRecover.mockResolvedValue({
    outcome: "no_pending_starter_checkout",
  })
  state.recover.mockResolvedValue("payment_confirmation_pending")
  render(<ProPayment returnTo="/plan-usage/" />)
  await waitFor(() =>
    expect(
      screen.queryByText(/Checking for an unfinished credit purchase/),
    ).toBeNull(),
  )
  fireEvent.click(screen.getByRole("button", { name: "Check payment status" }))
  await screen.findByText(/Payment status is pending/)
  expect(state.start).not.toHaveBeenCalled()
  expect(screen.getByRole("button", { name: "Check again" })).not.toBeDisabled()
})

describe("authoritative Pro offer terms context", () => {
  it("keys read-only terms by actor and active team without creating checkout", async () => {
    state.query = ""
    state.plans = availablePlans
    state.terms = {
      pro_checkout: { first_paid_pro_cycle: true, accepted: false },
    }
    const view = render(<ProPayment returnTo="/plan-usage/" />)
    await screen.findByText(/full billing month/)
    expect(state.termsQuery.mock.lastCall?.[0]).toMatchObject({
      queryKey: [
        "pro-checkout-terms",
        "self",
        "actor",
        "use:11111111-1111-4111-8111-111111111111",
      ],
      enabled: true,
    })
    expect(state.start).not.toHaveBeenCalled()
    state.actor = "another-actor"
    state.team = {
      teamId: "22222222-2222-4222-8222-222222222222",
      region: "usw",
    }
    state.terms = undefined
    view.rerender(<ProPayment returnTo="/plan-usage/" />)
    expect(screen.queryByText(/full billing month/)).toBeNull()
    expect(state.termsQuery.mock.lastCall?.[0]).toMatchObject({
      queryKey: [
        "pro-checkout-terms",
        "self",
        "another-actor",
        "usw:22222222-2222-4222-8222-222222222222",
      ],
    })
    expect(state.start).not.toHaveBeenCalled()
  })
  it.each(["error", "fetching", "not-ready", "impersonated"])(
    "does not display cached authoritative terms while %s",
    async (mode) => {
      state.query = ""
      state.plans = availablePlans
      state.terms = {
        pro_checkout: { first_paid_pro_cycle: true, accepted: false },
      }
      state.termsError = mode === "error"
      state.termsFetching = mode === "fetching"
      state.ready = mode !== "not-ready"
      state.scope = mode === "impersonated" ? "impersonated" : "self"
      render(<ProPayment returnTo="/plan-usage/" />)
      await waitFor(() =>
        expect(screen.queryByText(/full billing month/)).toBeNull(),
      )
      expect(state.start).not.toHaveBeenCalled()
    },
  )
})
