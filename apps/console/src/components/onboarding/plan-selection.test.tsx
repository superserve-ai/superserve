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

describe("reviewed signup billing step", () => {
  const reviewed = (requestedOffer: SignupPlanContext["requestedOffer"]) => ({
    ...selecting,
    reviewed: true,
    requestedOffer,
  })

  it("offers the card credit instead of buying the plan chosen at signup", async () => {
    vi.mocked(createStripeCheckoutSession).mockResolvedValue({
      id: "session",
      url: "https://checkout.stripe.com/c/pay/test",
    })
    render(<PlanSelection initial={reviewed("pro_annual")} />)
    expect(
      screen.queryByRole("button", { name: "Continue to payment" }),
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Add payment method" }))
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith(
        "https://checkout.stripe.com/c/pay/test",
      ),
    )
    expect(commitFreePlan).toHaveBeenCalledWith("use:team")
    expect(vi.mocked(commitFreePlan).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(createStripeCheckoutSession).mock.invocationCallOrder[0],
    )
    expect(createStripeCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedTeam: "use:team",
        successUrl: expect.stringContaining("billing=success"),
        cancelUrl: expect.stringContaining("billing=cancel"),
      }),
    )
    expect(startProCheckout).not.toHaveBeenCalled()
  })

  it("keeps the user on the card step when billing cannot open", async () => {
    vi.mocked(createStripeCheckoutSession).mockRejectedValue(
      new Error("Billing unavailable"),
    )
    vi.mocked(getSignupPlanAction)
      .mockResolvedValueOnce(reviewed("pro_monthly"))
      .mockResolvedValue({
        ...reviewed("pro_monthly"),
        state: "committed",
        offer: "free",
      })
    render(<PlanSelection initial={reviewed("pro_monthly")} />)
    fireEvent.click(screen.getByRole("button", { name: "Add payment method" }))
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Billing unavailable",
    )
    expect(
      screen.getByRole("button", { name: "Continue with $5 trial credit" }),
    ).toBeEnabled()
    expect(assign).not.toHaveBeenCalled()
  })

  it("starts on the trial credit without a card", async () => {
    render(<PlanSelection initial={reviewed("enterprise")} />)
    fireEvent.click(
      screen.getByRole("button", { name: "Continue with $5 trial credit" }),
    )
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/sandboxes"))
    expect(commitFreePlan).toHaveBeenCalledWith("use:team")
    expect(createStripeCheckoutSession).not.toHaveBeenCalled()
  })

  it("opens the console after leaving card checkout", async () => {
    const committed = {
      ...reviewed("pro_monthly"),
      state: "committed" as const,
      offer: "free" as const,
    }
    vi.mocked(getSignupPlanAction).mockResolvedValue(committed)
    render(<PlanSelection initial={committed} billingReturn="cancel" />)
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/sandboxes"))
    expect(
      screen.queryByRole("button", { name: "Skip for now" }),
    ).not.toBeInTheDocument()
  })
})
