import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { createStripeCheckoutSession } from "@/lib/api/billing-stripe"
import {
  commitFreePlan,
  recoverProPayment,
  startProCheckout,
} from "@/lib/api/plan-checkout"
import type { SignupPlanContext } from "@/lib/api/signup-plan"
import { getSignupPlanAction } from "@/lib/api/signup-plan-actions"

import { PlanSelection } from "./plan-selection"

vi.mock("@/lib/api/signup-plan-actions", () => ({
  getSignupPlanAction: vi.fn(),
}))
vi.mock("@/lib/api/plan-checkout", async (original) => ({
  ...(await original<object>()),
  commitFreePlan: vi.fn(),
  recoverProPayment: vi.fn(),
  startProCheckout: vi.fn(),
}))
vi.mock("@/lib/api/billing-stripe", () => ({
  createStripeCheckoutSession: vi.fn(),
}))
vi.mock("posthog-js", () => ({ default: { capture: vi.fn() } }))
vi.mock("@/lib/billing/plan-offers-actions", () => ({
  getTeamOffersAction: async () => null,
}))

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
  vi.mocked(commitFreePlan).mockResolvedValue(undefined)
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
    expect(commitFreePlan).not.toHaveBeenCalled()
  })
  it("skips Free billing only after the backend commits Free", async () => {
    let resolve!: () => void
    vi.mocked(commitFreePlan).mockReturnValue(
      new Promise<void>((r) => {
        resolve = r
      }),
    )
    render(<PlanSelection initial={selecting} />)
    fireEvent.click(screen.getByRole("button", { name: "Continue with Free" }))
    fireEvent.click(await screen.findByRole("button", { name: "Skip for now" }))
    expect(assign).not.toHaveBeenCalled()
    await act(async () => resolve())
    expect(commitFreePlan).toHaveBeenCalledWith("use:team")
    expect(assign).toHaveBeenCalledWith("/sandboxes")
    expect(createStripeCheckoutSession).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "Skip for now" })).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }))
    expect(commitFreePlan).toHaveBeenCalledTimes(1)
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
    expect(
      screen.queryByRole("button", { name: "Skip for now" }),
    ).not.toBeInTheDocument()
  })

  it("asks the backend to close the old attempt before unlocking plans", async () => {
    vi.mocked(getSignupPlanAction).mockResolvedValue(pending)
    render(<PlanSelection initial={pending} />)
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
      screen.queryByRole("button", { name: "Continue with Free" }),
    ).not.toBeInTheDocument()
    expect(
      await screen.findByRole("button", { name: "Continue with Free" }),
    ).toBeVisible()
    expect(recoverProPayment).toHaveBeenCalledWith("use:team", true)
  })

  it("recovers paid Pro instead of honoring a stale Free choice", async () => {
    vi.mocked(getSignupPlanAction).mockResolvedValue({
      ...pending,
      state: "committed",
    })
    render(<PlanSelection initial={selecting} />)
    fireEvent.click(screen.getByRole("button", { name: "Continue with Free" }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/sandboxes"))
    expect(commitFreePlan).not.toHaveBeenCalled()
    expect(
      screen.queryByRole("button", { name: "Skip for now" }),
    ).not.toBeInTheDocument()
  })

  it("keeps YC on the optional Free billing path", async () => {
    render(
      <PlanSelection initial={{ ...selecting, requestedOffer: "yc_2026" }} />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Continue with Free" }))
    expect(
      await screen.findByRole("button", { name: "Skip for now" }),
    ).toBeVisible()
    expect(startProCheckout).not.toHaveBeenCalled()
  })

  it("commits Free before opening Enterprise scheduling", async () => {
    const tab = {
      opener: {},
      location: { href: "about:blank" },
      close: vi.fn(),
    }
    vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window)
    render(<PlanSelection initial={selecting} />)
    fireEvent.click(screen.getByRole("button", { name: /Contact sales/ }))
    await waitFor(() =>
      expect(tab.location.href).toBe("https://www.superserve.ai/meet/"),
    )
    expect(tab.opener).toBeNull()
    expect(commitFreePlan).toHaveBeenCalledWith("use:team")
    expect(assign).toHaveBeenCalledWith("/sandboxes")
  })

  it("completes Enterprise onboarding with a scheduling fallback when popups are blocked", async () => {
    vi.spyOn(window, "open").mockReturnValue(null)
    render(<PlanSelection initial={selecting} />)
    fireEvent.click(screen.getByRole("button", { name: /Contact sales/ }))
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith("/sandboxes?contact_sales=1"),
    )
    expect(commitFreePlan).toHaveBeenCalledWith("use:team")
  })

  it("binds the optional Free billing return to its account and team", async () => {
    vi.mocked(createStripeCheckoutSession).mockResolvedValue({
      id: "session",
      url: "https://checkout.stripe.com/c/pay/test",
    })
    render(<PlanSelection initial={selecting} />)
    fireEvent.click(screen.getByRole("button", { name: "Continue with Free" }))
    fireEvent.click(
      await screen.findByRole("button", { name: "Add payment method" }),
    )
    await waitFor(() =>
      expect(createStripeCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({
          expectedTeam: "use:team",
          successUrl: expect.stringContaining(
            "team=use%3Ateam&account=user&billing=success",
          ),
          cancelUrl: expect.stringContaining(
            "team=use%3Ateam&account=user&billing=cancel",
          ),
        }),
      ),
    )
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
    expect(
      screen.queryByRole("button", { name: "Continue with Free" }),
    ).not.toBeInTheDocument()
  })
})

describe("return from Stripe's Back link", () => {
  const closesOnRestart = () =>
    vi.mocked(recoverProPayment).mockImplementation(async (_team, restart) => {
      if (!restart) return "payment_confirmation_pending"
      vi.mocked(getSignupPlanAction).mockResolvedValue(selecting)
      return "retryable"
    })

  beforeEach(() => {
    window.history.replaceState(
      null,
      "",
      "/onboarding/plan/?team=use%3Ateam&account=user&billing=cancel",
    )
    vi.mocked(getSignupPlanAction).mockResolvedValue(pending)
  })

  it("closes the unpaid checkout and shows the plans", async () => {
    let finishRecovery!: () => void
    vi.mocked(recoverProPayment).mockImplementation(
      (_team, restart) =>
        new Promise((resolve) => {
          finishRecovery = () => {
            vi.mocked(getSignupPlanAction).mockResolvedValue(selecting)
            resolve(restart ? "retryable" : "payment_confirmation_pending")
          }
        }),
    )
    render(<PlanSelection initial={pending} billingReturn="cancel" />)
    expect(
      await screen.findByRole("heading", { name: "Returning to plans" }),
    ).toBeVisible()
    await waitFor(() => expect(recoverProPayment).toHaveBeenCalledTimes(1))
    expect(recoverProPayment).toHaveBeenCalledWith("use:team", true)
    expect(
      screen.queryByRole("button", { name: "Continue with Free" }),
    ).not.toBeInTheDocument()
    await act(async () => finishRecovery())
    expect(
      await screen.findByRole("button", { name: "Continue with Free" }),
    ).toBeVisible()
    expect(window.location.search).toBe("?team=use%3Ateam&account=user")
    expect(assign).not.toHaveBeenCalled()
  })

  it("keeps waiting when the backend still sees the payment", async () => {
    render(<PlanSelection initial={pending} billingReturn="cancel" />)
    await waitFor(() =>
      expect(recoverProPayment).toHaveBeenCalledWith("use:team", true),
    )
    expect(
      await screen.findByRole("heading", {
        name: "We’re checking your payment",
      }),
    ).toBeVisible()
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Cancel checkout and change plan" }),
      ).toBeEnabled(),
    )
  })

  it("does not send the customer back to checkout", async () => {
    vi.mocked(recoverProPayment).mockResolvedValue(
      "https://checkout.stripe.com/c/pay/again",
    )
    render(<PlanSelection initial={pending} billingReturn="cancel" />)
    await waitFor(() =>
      expect(recoverProPayment).toHaveBeenCalledWith("use:team", true),
    )
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Check payment status" }),
      ).toBeEnabled(),
    )
    expect(assign).not.toHaveBeenCalled()
    fireEvent(window, new Event("focus"))
    await waitFor(() => expect(recoverProPayment).toHaveBeenCalledTimes(2))
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Check payment status" }),
      ).toBeEnabled(),
    )
    expect(assign).not.toHaveBeenCalled()
    fireEvent.click(
      screen.getByRole("button", { name: "Check payment status" }),
    )
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith(
        "https://checkout.stripe.com/c/pay/again",
      ),
    )
  })

  it("closes the checkout only once", async () => {
    closesOnRestart()
    render(<PlanSelection initial={pending} billingReturn="cancel" />)
    expect(
      await screen.findByRole("button", { name: "Continue with Free" }),
    ).toBeVisible()
    fireEvent(window, new Event("focus"))
    await waitFor(() => expect(getSignupPlanAction).toHaveBeenCalledTimes(3))
    expect(
      vi.mocked(recoverProPayment).mock.calls.filter(([, restart]) => restart),
    ).toHaveLength(1)
  })

  it("does not close a checkout started after the return", async () => {
    vi.mocked(getSignupPlanAction).mockResolvedValue(selecting)
    vi.mocked(startProCheckout).mockImplementation(async () => {
      vi.mocked(getSignupPlanAction).mockResolvedValue(pending)
      return null
    })
    render(<PlanSelection initial={selecting} billingReturn="cancel" />)
    expect(window.location.search).toBe("?team=use%3Ateam&account=user")
    fireEvent.click(screen.getByRole("button", { name: "Continue to payment" }))
    expect(
      await screen.findByRole("heading", {
        name: "We’re checking your payment",
      }),
    ).toBeVisible()
    await waitFor(() => expect(recoverProPayment).toHaveBeenCalled())
    expect(recoverProPayment).not.toHaveBeenCalledWith("use:team", true)
  })

  it("leaves a team without a pending payment on the plans", async () => {
    vi.mocked(getSignupPlanAction).mockResolvedValue(selecting)
    render(<PlanSelection initial={selecting} billingReturn="cancel" />)
    expect(
      screen.getByRole("button", { name: "Continue with Free" }),
    ).toBeVisible()
    fireEvent(window, new Event("focus"))
    await waitFor(() => expect(getSignupPlanAction).toHaveBeenCalled())
    expect(recoverProPayment).not.toHaveBeenCalled()
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
