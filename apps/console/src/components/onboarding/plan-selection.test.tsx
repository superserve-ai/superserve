import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { recoverProPayment, startProCheckout } from "@/lib/api/plan-checkout"
import type { SignupPlanContext } from "@/lib/api/signup-plan"
import { getSignupPlanAction } from "@/lib/api/signup-plan-actions"

import { PlanSelection } from "./plan-selection"

vi.mock("@/lib/api/signup-plan-actions", () => ({
  getSignupPlanAction: vi.fn(),
}))
vi.mock("@/lib/api/plan-checkout", async (original) => ({
  ...(await original<object>()),
  recoverProPayment: vi.fn(),
  startProCheckout: vi.fn(),
}))
vi.mock("posthog-js", () => ({ default: { capture: vi.fn() } }))

const selecting: SignupPlanContext = {
  userId: "user",
  teamKey: "use:team",
  state: "selecting",
  offer: null,
}
const pending: SignupPlanContext = {
  ...selecting,
  state: "pending",
  offer: "pro_annual",
}
const assign = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(window.location, "assign").mockImplementation(assign)
  vi.mocked(getSignupPlanAction).mockResolvedValue(selecting)
  vi.mocked(recoverProPayment).mockResolvedValue("payment_confirmation_pending")
})

describe("onboarding plan flow", () => {
  it("returns YC teams to their claim without offering conflicting purchases", async () => {
    render(<PlanSelection initial={{ ...selecting, state: "yc_claim" }} />)
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/yc/claim/"))
    expect(
      screen.queryByRole("button", { name: "Continue with Free" }),
    ).not.toBeInTheDocument()
    expect(startProCheckout).not.toHaveBeenCalled()
  })
  it("offers no Free plan to a team still choosing", () => {
    render(<PlanSelection initial={selecting} />)
    expect(screen.queryByRole("region", { name: "Free plan" })).toBeNull()
    expect(
      screen.queryByRole("button", { name: /Free|Skip for now/ }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Continue to payment" }),
    ).toBeVisible()
  })

  it("sends the selected Pro offer straight to Checkout", async () => {
    vi.mocked(startProCheckout).mockResolvedValue(
      "https://checkout.stripe.com/c/pay/test",
    )
    render(
      <PlanSelection
        initial={{ ...selecting, requestedOffer: "pro_annual" }}
      />,
    )
    fireEvent.click(screen.getByRole("radio", { name: "monthly" }))
    fireEvent.click(screen.getByRole("button", { name: "Continue to payment" }))
    await waitFor(() =>
      expect(startProCheckout).toHaveBeenCalledWith(
        "use:team",
        "pro_monthly",
        expect.stringContaining(
          "/onboarding/plan/?team=use%3Ateam&account=user",
        ),
        "user",
      ),
    )
    expect(assign).toHaveBeenCalledWith(
      "https://checkout.stripe.com/c/pay/test",
    )
  })

  it("does not trust a Stripe success parameter while payment remains pending", async () => {
    vi.mocked(getSignupPlanAction).mockResolvedValue(pending)
    render(<PlanSelection initial={pending} billingReturn="success" />)
    await waitFor(() =>
      expect(recoverProPayment).toHaveBeenCalledWith("use:team", false),
    )
    expect(
      screen.getByRole("heading", { name: "We’re checking your payment" }),
    ).toBeVisible()
    expect(assign).not.toHaveBeenCalled()
  })

  it("asks the backend to close the old attempt before unlocking plans", async () => {
    vi.mocked(getSignupPlanAction).mockResolvedValue(pending)
    render(<PlanSelection initial={pending} billingReturn="cancel" />)
    const cancel = screen.getByRole("button", {
      name: "Cancel checkout and change plan",
    })
    await waitFor(() => expect(cancel).toBeEnabled())
    vi.mocked(recoverProPayment).mockImplementation(async (_team, restart) => {
      if (restart) {
        vi.mocked(getSignupPlanAction).mockResolvedValue(selecting)
        return "retryable"
      }
      return "payment_confirmation_pending"
    })
    fireEvent.click(cancel)
    expect(
      screen.queryByRole("button", { name: "Continue to payment" }),
    ).not.toBeInTheDocument()
    expect(
      await screen.findByRole("button", { name: "Continue to payment" }),
    ).toBeVisible()
    expect(recoverProPayment).toHaveBeenCalledWith("use:team", true)
  })

  it("recovers paid Pro instead of starting another checkout", async () => {
    vi.mocked(getSignupPlanAction).mockResolvedValue({
      ...pending,
      state: "committed",
    })
    render(<PlanSelection initial={selecting} />)
    fireEvent.click(screen.getByRole("button", { name: "Continue to payment" }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/sandboxes"))
    expect(startProCheckout).not.toHaveBeenCalled()
  })

  it("opens Enterprise scheduling without choosing a plan", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null)
    render(<PlanSelection initial={selecting} />)
    fireEvent.click(screen.getByRole("button", { name: /Contact sales/ }))
    expect(open).toHaveBeenCalledWith(
      "https://www.superserve.ai/meet/",
      "_blank",
      "noopener,noreferrer",
    )
    expect(assign).not.toHaveBeenCalled()
    expect(getSignupPlanAction).not.toHaveBeenCalled()
  })

  it("does not start another purchase when a lost response leaves status unreadable", async () => {
    vi.mocked(startProCheckout).mockRejectedValue(new Error("Connection lost"))
    vi.mocked(getSignupPlanAction)
      .mockResolvedValueOnce(selecting)
      .mockRejectedValue(new Error("Unavailable"))
    render(<PlanSelection initial={selecting} />)
    fireEvent.click(screen.getByRole("button", { name: "Continue to payment" }))
    expect(
      await screen.findByRole("heading", {
        name: "We couldn’t confirm your plan",
      }),
    ).toBeVisible()
  })
})

it("rechecks checkout after browser Back restores the previous page", async () => {
  vi.mocked(startProCheckout).mockResolvedValue(
    "https://checkout.stripe.com/c/pay/test",
  )
  render(<PlanSelection initial={selecting} />)
  fireEvent.click(screen.getByRole("button", { name: "Continue to payment" }))
  await waitFor(() => expect(assign).toHaveBeenCalled())
  expect(
    screen.getByRole("button", { name: "Continue to payment" }),
  ).toBeDisabled()
  const reads = vi.mocked(getSignupPlanAction).mock.calls.length
  const restored = new Event("pageshow")
  Object.defineProperty(restored, "persisted", { value: true })
  fireEvent(window, restored)
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Continue to payment" }),
    ).toBeEnabled(),
  )
  expect(vi.mocked(getSignupPlanAction).mock.calls.length).toBeGreaterThan(
    reads,
  )
  expect(startProCheckout).toHaveBeenCalledTimes(1)
})
