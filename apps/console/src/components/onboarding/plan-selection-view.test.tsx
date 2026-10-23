import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

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
