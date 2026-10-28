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
    cadence: "annual",
    busy: false,
    onCadence: vi.fn(),
    onPro: vi.fn(),
    onEnterprise: vi.fn(),
    onCheckPayment: vi.fn(),
    onCancelPayment: vi.fn(),
    ...overrides,
  }
}

describe("Plan selection", () => {
  it("offers Pro and Enterprise but no Free plan, with cadence only in Pro", () => {
    render(<PlanSelectionView {...props()} />)
    expect(screen.queryByRole("region", { name: "Free plan" })).toBeNull()
    expect(screen.queryByText(/Free/)).toBeNull()
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
    const handlers = props({ cadence: "monthly" })
    render(<PlanSelectionView {...handlers} />)
    expect(screen.getByRole("radio", { name: "monthly" })).toBeChecked()
    expect(screen.getByText("$1,200 billed monthly")).toBeVisible()
    fireEvent.click(screen.getByRole("button", { name: "Continue to payment" }))
    expect(handlers.onPro).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole("button", { name: /Contact sales/ }))
    expect(handlers.onEnterprise).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole("radio", { name: "annual" }))
    expect(handlers.onCadence).toHaveBeenCalledWith("annual")
  })

  it("offers recovery instead of conflicting plan choices while payment is uncertain", () => {
    const handlers = props({ step: "payment-pending" })
    render(<PlanSelectionView {...handlers} />)
    expect(
      screen.getByRole("heading", { name: "We’re checking your payment" }),
    ).toBeVisible()
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
