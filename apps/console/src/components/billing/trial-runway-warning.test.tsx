import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { BillingSummaryResponse } from "@/lib/api/billing"

const mocks = vi.hoisted(() => ({
  summary: vi.fn(),
  entry: vi.fn(),
  scope: "self",
  teamKey: "use:team-1" as string | null,
  user: { id: "account-1" } as { id: string } | null,
  posthog: {
    isFeatureEnabled: vi.fn(),
    onFeatureFlags: vi.fn(() => () => {}),
    capture: vi.fn(),
  },
}))
vi.mock("posthog-js/react", () => ({ usePostHog: () => mocks.posthog }))
vi.mock("@/hooks/use-billing-summary", () => ({
  useBillingSummary: mocks.summary,
}))
vi.mock("@/hooks/use-billing-v2", () => ({ useTeamEntry: mocks.entry }))
vi.mock("@/hooks/use-billing-context", () => ({
  useBillingContext: () => ({
    cacheScope: mocks.scope,
    teamKey: mocks.teamKey,
    ready: mocks.teamKey !== null,
  }),
}))
vi.mock("@/hooks/use-user", () => ({
  useUser: () => ({ user: mocks.user, loading: false }),
}))
vi.mock("@/components/query-provider", () => ({
  useQueryScope: () => mocks.scope,
}))

import { TrialRunwayWarning } from "./trial-runway-warning"

const T0 = Date.parse("2026-11-18T08:00:00Z")
const FLAG = "trial-runway-warning"

function summary(
  remaining: number,
  at = T0,
  overrides: Partial<BillingSummaryResponse> = {},
) {
  return {
    permissions: { can_view: true, can_manage: true },
    trial: { state: "active", eligible: true, remaining_usd: remaining },
    calculated_at: new Date(at).toISOString(),
    ...overrides,
  }
}

function view() {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <TrialRunwayWarning fallback={<div data-testid="trial-banner" />} />
    </QueryClientProvider>
  )
}

function captured(event: string) {
  return mocks.posthog.capture.mock.calls.filter(([name]) => name === event)
}

let team = 0
beforeEach(() => {
  // A new team per test keeps the once-per-session dedupe apart.
  team += 1
  mocks.teamKey = `use:team-${team}`
  mocks.scope = "self"
  mocks.user = { id: "account-1" }
  mocks.entry.mockReturnValue({ data: "trial" })
  mocks.summary.mockReturnValue({ data: summary(0.015), isError: false })
  mocks.posthog.isFeatureEnabled.mockReset().mockReturnValue(true)
  mocks.posthog.capture.mockReset()
  window.sessionStorage.clear()
})
afterEach(cleanup)

describe("TrialRunwayWarning with the flag off", () => {
  it.each([
    ["off", false],
    ["missing", undefined],
  ])("keeps the trial banner when the flag is %s", (_, value) => {
    mocks.posthog.isFeatureEnabled.mockReturnValue(value)
    render(view())
    expect(screen.getByTestId("trial-banner")).toBeInTheDocument()
    expect(screen.queryByText(/credit is almost used up/)).toBeNull()
    expect(mocks.posthog.capture).not.toHaveBeenCalled()
  })

  it("keeps the trial banner when PostHog throws", () => {
    mocks.posthog.isFeatureEnabled.mockImplementation(() => {
      throw new Error("posthog failed")
    })
    render(view())
    expect(screen.getByTestId("trial-banner")).toBeInTheDocument()
    expect(mocks.posthog.capture).not.toHaveBeenCalled()
  })
})

describe("TrialRunwayWarning with the flag on", () => {
  it("warns at the fixed threshold before a burn rate is known", () => {
    render(view())
    expect(screen.queryByTestId("trial-banner")).toBeNull()
    expect(
      screen.getByText(/Your free trial credit is almost used up\./),
    ).toHaveTextContent(
      "When it runs out, your running sandboxes stop. Choose a plan to keep them running.",
    )
    expect(screen.getByRole("link", { name: "Choose a plan" })).toHaveAttribute(
      "href",
      `/auth/choose-plan?reason=upgrade&account=account-1&team=use%3A${mocks.teamKey?.slice(4)}`,
    )
    expect(mocks.posthog.isFeatureEnabled).toHaveBeenCalledWith(FLAG)
    expect(captured("trial_runway_warning_shown")).toEqual([
      [
        "trial_runway_warning_shown",
        {
          team_id: mocks.teamKey?.slice(4),
          region: "use",
          remaining_usd: 0.015,
          threshold_mode: "fixed",
          threshold_minutes: 10,
          threshold_usd: 0.02,
          minutes_left: null,
          burn_usd_per_minute: null,
          can_manage: true,
        },
      ],
    ])
  })

  it("does not read the flag when the credit is not close to running out", () => {
    mocks.summary.mockReturnValue({ data: summary(0.04), isError: false })
    render(view())
    expect(screen.getByTestId("trial-banner")).toBeInTheDocument()
    expect(mocks.posthog.isFeatureEnabled).not.toHaveBeenCalled()
  })

  it("uses the burn rate between two readings", () => {
    mocks.summary.mockReturnValue({ data: summary(0.022), isError: false })
    const { rerender } = render(view())
    expect(screen.getByTestId("trial-banner")).toBeInTheDocument()

    // $0.002 a minute leaves 9 minutes.
    mocks.summary.mockReturnValue({
      data: summary(0.018, T0 + 120_000),
      isError: false,
    })
    rerender(view())
    expect(screen.getByText(/runs out in/)).toHaveTextContent(
      "At your current usage, your free trial credit runs out in about 9 minutes.",
    )
    expect(captured("trial_runway_warning_shown")[0]?.[1]).toMatchObject({
      threshold_mode: "burn_rate",
      minutes_left: 9,
      burn_usd_per_minute: 0.002,
    })
  })

  it("hides the warning when nothing uses credit", () => {
    const { rerender } = render(view())
    expect(screen.queryByTestId("trial-banner")).toBeNull()
    mocks.summary.mockReturnValue({
      data: summary(0.015, T0 + 60_000),
      isError: false,
    })
    rerender(view())
    expect(screen.getByTestId("trial-banner")).toBeInTheDocument()
  })

  it("sends the shown event once per team per session", () => {
    const first = render(view())
    first.unmount()
    render(view())
    expect(captured("trial_runway_warning_shown")).toHaveLength(1)
  })

  it("records the click", () => {
    render(view())
    fireEvent.click(screen.getByRole("link", { name: "Choose a plan" }))
    expect(captured("trial_runway_warning_clicked")).toHaveLength(1)
    expect(captured("trial_runway_warning_clicked")[0]?.[1]).toMatchObject({
      remaining_usd: 0.015,
      threshold_mode: "fixed",
    })
  })

  it("asks a member without billing access to contact an administrator", () => {
    mocks.summary.mockReturnValue({
      data: summary(0.015, T0, {
        permissions: { can_view: true, can_manage: false },
      }),
      isError: false,
    })
    render(view())
    expect(screen.queryByRole("link")).toBeNull()
    expect(
      screen.getByText(/billing administrator to choose a plan/),
    ).toBeInTheDocument()
  })

  it.each([
    [
      "an ended trial",
      () => mocks.entry.mockReturnValue({ data: "trial_ended" }),
    ],
    [
      "a team without a trial entry",
      () => mocks.entry.mockReturnValue({ data: null }),
    ],
    ["a support view of a team", () => (mocks.scope = "team-1")],
    [
      "a failed summary read",
      () =>
        mocks.summary.mockReturnValue({ data: summary(0.015), isError: true }),
    ],
  ])("does not warn for %s", (_, setup) => {
    setup()
    render(view())
    expect(screen.getByTestId("trial-banner")).toBeInTheDocument()
    expect(mocks.posthog.isFeatureEnabled).not.toHaveBeenCalled()
    expect(mocks.posthog.capture).not.toHaveBeenCalled()
  })
})
