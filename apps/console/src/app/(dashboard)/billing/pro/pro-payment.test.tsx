import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { PublicBillingPlans } from "@/lib/billing/plans"

import { ProPayment } from "./pro-payment"

const state = vi.hoisted(() => ({
  team: { teamId: "team-a", region: "use" },
  recover: vi.fn(),
  start: vi.fn(),
  plans: undefined as PublicBillingPlans | undefined,
  replace: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: state.replace }),
}))
vi.mock("@/components/query-provider", () => ({
  useDashboardTeamContext: () => state.team,
}))
vi.mock("@/components/page-header", () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}))
vi.mock("@/hooks/use-teams", () => ({ useTeams: () => ({ data: null }) }))
vi.mock("@/hooks/use-billing-summary", () => ({
  useBillingSummary: () => ({ data: null, isPending: false }),
}))
vi.mock("@/hooks/use-public-billing-plans", () => ({
  usePublicBillingPlans: () => ({ data: state.plans, isPending: false }),
}))
vi.mock("@/lib/api/plan-checkout", () => ({
  recoverProPayment: (...args: unknown[]) => state.recover(...args),
  startProCheckout: (...args: unknown[]) => state.start(...args),
  isStripeCheckoutUrl: vi.fn(),
}))

beforeEach(() => {
  state.team = { teamId: "team-a", region: "use" }
  state.recover.mockReset()
  state.start.mockReset()
  state.plans = undefined
  state.replace.mockReset()
})

describe("Pro payment return recovery", () => {
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
    state.plans = {
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
})
