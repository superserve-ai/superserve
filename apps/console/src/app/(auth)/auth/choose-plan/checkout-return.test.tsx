import { render, waitFor } from "@testing-library/react"
import { StrictMode } from "react"
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
  outcome: null as TrialOutcome | null,
  perTeam: {} as Record<string, TrialOutcome | null>,
}))
vi.mock("@/lib/billing/plan-offers-actions", () => ({
  getTeamCatalogAction: async () => null,
  getTrialOutcomeAction: async ({ team }: { team: string }) =>
    team in trial.perTeam ? trial.perTeam[team] : trial.outcome,
}))
const { capture } = vi.hoisted(() => ({ capture: vi.fn() }))
vi.mock("posthog-js", () => ({ default: { capture } }))

const { cancel } = vi.hoisted(() => ({ cancel: vi.fn(async () => {}) }))
vi.mock("@/lib/posthog/checkout-actions", () => ({
  recordPlanPickerCancelAction: cancel,
}))

import type { TrialOutcome } from "@/lib/billing/signup-checkout-paths"

import ChoosePlanPage from "./page"

describe("plan picker checkout return", () => {
  beforeEach(() => {
    cancel.mockClear()
    trial.outcome = null
    trial.perTeam = {}
  })

  it("records one cancelled Checkout under StrictMode", async () => {
    params = new URLSearchParams({
      reason: "checkout_canceled",
      offer: "pro_monthly",
      account: "u1",
      team: "use:team-1",
    })
    render(
      <StrictMode>
        <ChoosePlanPage />
      </StrictMode>,
    )
    await waitFor(() => expect(cancel).toHaveBeenCalledOnce())
    expect(cancel).toHaveBeenCalledWith({
      account: "u1",
      team: "use:team-1",
      offer: "pro_monthly",
    })
  })

  it("records no return for other picker reasons or a link without a team", () => {
    params = new URLSearchParams({
      reason: "trial_ended",
      account: "u1",
      team: "use:team-1",
    })
    render(<ChoosePlanPage />)
    params = new URLSearchParams({ reason: "checkout_canceled" })
    render(<ChoosePlanPage />)
    expect(cancel).not.toHaveBeenCalled()
  })
})
