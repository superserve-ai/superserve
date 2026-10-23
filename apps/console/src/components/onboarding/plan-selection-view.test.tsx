import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { PublicBillingPlans } from "@/lib/billing/plans"
import { publicBillingPlansFixture } from "@/lib/billing/plans.fixture"

import {
  PlanSelectionView,
  type PlanSelectionViewProps,
} from "./plan-selection-view"

function props(
  overrides: Partial<PlanSelectionViewProps> = {},
): PlanSelectionViewProps {
  return {
    step: "plans",
    selection: "free",
    cadence: "annual",
    busy: false,
    plans: publicBillingPlansFixture,
    onCadence: vi.fn(),
    onFree: vi.fn(),
    onPro: vi.fn(),
    onEnterprise: vi.fn(),
    onAddCard: vi.fn(),
    onSkip: vi.fn(),
    onBack: vi.fn(),
    onCheckPayment: vi.fn(),
    onCancelPayment: vi.fn(),
    ...overrides,
  }
}

describe("Plan selection", () => {
  it("renders prices, credits and limits from the plan catalog", () => {
    const [starter, pro, enterprise] = publicBillingPlansFixture.cards
    const plans: PublicBillingPlans = {
      cards: [
        starter!,
        {
          ...pro!,
          name: "Pro Plus",
          features: ["Slack support"],
          monthly: {
            ...pro!.monthly!,
            price_cents: 150000,
            monthly_equivalent_cents: 150000,
          },
          annual: {
            ...pro!.annual!,
            price_cents: 1440000,
            monthly_equivalent_cents: 120000,
          },
          monthly_credit_cents: 125000,
          limits: { ...pro!.limits, max_sandboxes: 2000 },
        },
        enterprise!,
      ],
      signup: { trial_credit_cents: 700, card_bonus_cents: 12000 },
    }
    render(<PlanSelectionView {...props({ plans })} />)
    const card = within(screen.getByRole("region", { name: "Pro Plus plan" }))
    expect(card.getByText("$1,200")).toBeVisible()
    expect(card.getByText(/14,400 billed annually · Save 20%/)).toBeVisible()
    expect(
      card.getByText("$1,250 in metered usage included each month"),
    ).toBeVisible()
    expect(card.getByText("Slack support")).toBeVisible()
    expect(card.getByText("Up to 2,000 concurrent sandboxes")).toBeVisible()
    expect(
      screen.getByText(
        "$7 to start, plus $120 when you add billing, if eligible",
      ),
    ).toBeVisible()
  })

  it("does not show stale amounts when the catalog is unavailable", () => {
    render(<PlanSelectionView {...props({ plans: null })} />)
    expect(
      screen.queryByText(/\$1,200|\$95|\$5 to start/),
    ).not.toBeInTheDocument()
    expect(
      screen.getByText("Pricing is unavailable. Reload or contact our team."),
    ).toBeVisible()
    expect(
      screen.getByRole("button", { name: "Continue to payment" }),
    ).toBeDisabled()
  })

  it("does not sell a plan the catalog marks unavailable", () => {
    const [starter, pro, enterprise] = publicBillingPlansFixture.cards
    const plans: PublicBillingPlans = {
      ...publicBillingPlansFixture,
      cards: [
        starter!,
        { ...pro!, monthly: { ...pro!.monthly!, available: false } },
        enterprise!,
      ],
    }
    render(<PlanSelectionView {...props({ plans, cadence: "monthly" })} />)
    expect(
      screen.getByRole("button", { name: "Continue to payment" }),
    ).toBeDisabled()
  })

  it("shows three plans, with cadence only in Pro and incremental Enterprise benefits", () => {
    render(<PlanSelectionView {...props()} />)
    const pro = within(screen.getByRole("region", { name: "Pro plan" }))
    expect(pro.getByRole("radio", { name: "annual" })).toBeChecked()
    expect(pro.getByText(/12,000 billed annually/)).toBeVisible()
    expect(screen.getAllByRole("radio")).toHaveLength(2)
    expect(
      within(screen.getByRole("region", { name: "Enterprise plan" })).getByText(
        "Everything in Pro, plus:",
      ),
    ).toBeVisible()
    expect(
      screen.getByRole("navigation", { name: "Account setup progress" }),
    ).toHaveTextContent("Create account")
    expect(screen.getByText("Choose plan").closest("li")).toHaveAttribute(
      "aria-current",
      "step",
    )
  })

  it("uses the displayed cadence and goes directly to the chosen action", () => {
    const handlers = props({ cadence: "monthly", selection: "pro" })
    render(<PlanSelectionView {...handlers} />)
    expect(screen.getByRole("radio", { name: "monthly" })).toBeChecked()
    expect(screen.getByText("$1,200 billed monthly")).toBeVisible()
    fireEvent.click(screen.getByRole("button", { name: "Continue to payment" }))
    expect(handlers.onPro).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole("button", { name: "Continue with Free" }))
    expect(handlers.onFree).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole("button", { name: /Contact sales/ }))
    expect(handlers.onEnterprise).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole("radio", { name: "annual" }))
    expect(handlers.onCadence).toHaveBeenCalledWith("annual")
  })

  it("lets Free users add a card or skip while retaining the trial", () => {
    const handlers = props({ step: "free-billing" })
    render(<PlanSelectionView {...handlers} />)
    expect(screen.getByText(/start with your \$5 trial/)).toBeVisible()
    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }))
    expect(handlers.onSkip).toHaveBeenCalledOnce()
    expect(handlers.onAddCard).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Add payment method" }))
    expect(handlers.onAddCard).toHaveBeenCalledOnce()
  })

  it("offers recovery instead of conflicting plan choices while payment is uncertain", () => {
    const handlers = props({ step: "payment-pending" })
    render(<PlanSelectionView {...handlers} />)
    expect(
      screen.getByRole("heading", { name: "We’re checking your payment" }),
    ).toBeVisible()
    expect(
      screen.queryByRole("button", { name: "Skip for now" }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Continue to payment" }),
    ).not.toBeInTheDocument()
    fireEvent.click(
      screen.getByRole("button", { name: "Check payment status" }),
    )
    expect(handlers.onCheckPayment).toHaveBeenCalledOnce()
    fireEvent.click(
      screen.getByRole("button", { name: "Cancel checkout and change plan" }),
    )
    expect(handlers.onCancelPayment).toHaveBeenCalledOnce()
  })

  it("disables every action during a request and announces errors", () => {
    render(
      <PlanSelectionView {...props({ busy: true, error: "Please retry." })} />,
    )
    for (const button of screen.getAllByRole("button"))
      expect(button).toBeDisabled()
    for (const radio of screen.getAllByRole("radio"))
      expect(radio).toBeDisabled()
    expect(screen.getByRole("alert")).toHaveTextContent("Please retry.")
  })
})
