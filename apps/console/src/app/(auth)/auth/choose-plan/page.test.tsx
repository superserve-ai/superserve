import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

let params = new URLSearchParams()
const replace = vi.fn()
vi.mock("next/navigation", () => ({
  useSearchParams: () => params,
  useRouter: () => ({ replace }),
}))
vi.mock("next/image", () => ({
  default: ({ alt }: { alt: string }) => <span>{alt}</span>,
}))
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode
    href: string
  }) => <a href={href}>{children}</a>,
}))
vi.mock("@superserve/ui", () => ({
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(" "),
  Button: ({
    render,
    children,
    ...props
  }: React.ComponentProps<"button"> & { render?: React.ReactElement }) =>
    render ? (
      <a href={(render.props as { href: string }).href}>{children}</a>
    ) : (
      <button {...props}>{children}</button>
    ),
}))
vi.mock("@/components/corner-brackets", () => ({ CornerBrackets: () => null }))
const trial = vi.hoisted(() => ({
  outcome: null as "used_up" | "unavailable" | null,
  perTeam: {} as Record<string, "used_up" | "unavailable" | null>,
}))
vi.mock("@/lib/billing/plan-offers-actions", () => ({
  getTeamCatalogAction: async () => null,
  getTrialOutcomeAction: async ({ team }: { team: string }) =>
    team in trial.perTeam ? trial.perTeam[team] : trial.outcome,
}))

import ChoosePlanPage from "./page"

describe("plan picker", () => {
  beforeEach(() => {
    params = new URLSearchParams()
    replace.mockReset()
    trial.outcome = null
    trial.perTeam = {}
  })

  it("offers both plans when the trial has ended", async () => {
    params = new URLSearchParams({
      reason: "trial_ended",
      offer: "developer",
      account: "u1",
      team: "use:team-1",
    })
    render(<ChoosePlanPage />)
    expect(
      (await screen.findByRole("button", { name: "Developer" }))
        .closest("form")!
        .getAttribute("action"),
    ).toBe(
      "/api/onboarding/checkout/?offer=developer&account=u1&team=use%3Ateam-1",
    )
    expect(screen.getByRole("button", { name: "Pro" })).toBeTruthy()
  })

  it("says the trial is used up only when its balance shows it was", async () => {
    trial.outcome = "used_up"
    params = new URLSearchParams({
      reason: "trial_ended",
      account: "u1",
      team: "use:team-1",
    })
    render(<ChoosePlanPage />)
    expect(await screen.findByText(/Your free trial is used up/)).toBeTruthy()
    expect(screen.getByText(/nothing is deleted/)).toBeTruthy()
  })

  it("drops the previous team's used-up message when the team changes", async () => {
    trial.perTeam = { "use:t1": "used_up", "use:t2": "unavailable" }
    params = new URLSearchParams({
      reason: "trial_ended",
      account: "u1",
      team: "use:t1",
    })
    const { rerender } = render(<ChoosePlanPage />)
    expect(await screen.findByText(/Your free trial is used up/)).toBeTruthy()
    params = new URLSearchParams({
      reason: "trial_ended",
      account: "u1",
      team: "use:t2",
    })
    rerender(<ChoosePlanPage />)
    expect(screen.queryByText(/used up/)).toBeNull()
    expect(
      await screen.findByText(/The free trial isn't available/),
    ).toBeTruthy()
    expect(screen.queryByText(/used up/)).toBeNull()
  })

  it.each(["unavailable", null] as const)(
    "does not say the trial is used up when the trial outcome is %s",
    async (outcome) => {
      trial.outcome = outcome
      params = new URLSearchParams({
        reason: "trial_ended",
        account: "u1",
        team: "use:team-1",
      })
      render(<ChoosePlanPage />)
      expect(
        await screen.findByText(
          "The free trial isn't available for this account. Choose a plan to run sandboxes.",
        ),
      ).toBeTruthy()
      expect(screen.queryByText(/used up/)).toBeNull()
    },
  )

  it("only re-checks the original checkout for checkout_elsewhere", () => {
    params = new URLSearchParams({
      reason: "checkout_elsewhere",
      account: "u1",
      team: "use:team-1",
    })
    render(<ChoosePlanPage />)
    expect(screen.queryByRole("button", { name: "Developer" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Pro" })).toBeNull()
    expect(
      screen.getByRole("link", { name: "Check again" }).getAttribute("href"),
    ).toBe("/api/onboarding/checkout/return/?account=u1&team=use%3Ateam-1")
  })

  it("sends an old payment-confirming link to the payment wait, not the picker", () => {
    params = new URLSearchParams({
      reason: "payment_confirming",
      account: "u1",
      team: "use:team-1",
    })
    render(<ChoosePlanPage />)
    expect(screen.queryByRole("button", { name: "Developer" })).toBeNull()
    expect(screen.queryByText("Choose a plan")).toBeNull()
    expect(replace).toHaveBeenCalledWith(
      "/onboarding/payment/?account=u1&team=use%3Ateam-1",
    )
  })

  it.each(["checkout_refused", "checkout_unavailable"])(
    "keeps the plans and adds a support contact for %s",
    async (reason) => {
      params = new URLSearchParams({
        reason,
        account: "u1",
        team: "use:team-1",
      })
      render(<ChoosePlanPage />)
      expect(
        await screen.findByRole("button", { name: "Developer" }),
      ).toBeTruthy()
      expect(
        screen
          .getByRole("link", { name: "support@superserve.ai" })
          .getAttribute("href"),
      ).toBe("mailto:support@superserve.ai")
    },
  )

  it("shows no support contact when checkout simply was cancelled", async () => {
    params = new URLSearchParams({
      reason: "checkout_canceled",
      account: "u1",
      team: "use:team-1",
    })
    render(<ChoosePlanPage />)
    await screen.findByRole("button", { name: "Developer" })
    expect(
      screen.queryByRole("link", { name: "support@superserve.ai" }),
    ).toBeNull()
  })

  it("offers no purchase without the account and team it was shown for", () => {
    params = new URLSearchParams({ reason: "trial_ended", offer: "developer" })
    render(<ChoosePlanPage />)
    expect(screen.queryByRole("button", { name: "Developer" })).toBeNull()
    expect(screen.getByRole("link", { name: "Back to console" })).toBeTruthy()
    expect(screen.queryByText(/used up/)).toBeNull()
  })

  it("offers no purchase when a checkout return names no checkout", () => {
    params = new URLSearchParams({ reason: "checkout_elsewhere" })
    render(<ChoosePlanPage />)
    expect(screen.queryByRole("button", { name: "Developer" })).toBeNull()
    expect(
      screen
        .getByRole("link", { name: "Back to console" })
        .getAttribute("href"),
    ).toBe("/sandboxes")
  })
})
