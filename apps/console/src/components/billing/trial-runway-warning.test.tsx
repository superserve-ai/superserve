import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { BillingSummaryResponse } from "@/lib/api/billing"

const mocks = vi.hoisted(() => ({
  summary: vi.fn(),
  entry: vi.fn(),
  scope: "self",
  teamKey: "use:team-1" as string | null,
  posthog: {
    isFeatureEnabled: vi.fn(),
    onFeatureFlags: vi.fn(() => () => {}),
    on: vi.fn(() => () => {}),
    get_property: vi.fn(() => undefined),
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
// The upgrade action has its own tests; this one only needs its callback.
vi.mock("@/components/billing/trial-upgrade-action", () => ({
  TrialUpgradeAction: ({
    onAction,
  }: {
    onAction?: (target: string) => void
  }) => (
    <button type="button" onClick={() => onAction?.("checkout")}>
      Upgrade
    </button>
  ),
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
  // The browser clock matches the summary times unless a test moves it.
  vi.useFakeTimers({ now: T0, toFake: ["Date"] })
  // A new team per test keeps the once-per-session dedupe apart.
  team += 1
  mocks.teamKey = `use:team-${team}`
  mocks.scope = "self"
  mocks.entry.mockReturnValue({ data: "trial" })
  mocks.summary.mockReturnValue({
    data: summary(0.015),
    isError: false,
    dataUpdatedAt: Date.now(),
  })
  mocks.posthog.isFeatureEnabled.mockReset().mockReturnValue(true)
  mocks.posthog.capture.mockReset()
  window.sessionStorage.clear()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

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
      "When it runs out, your running sandboxes stop. Upgrade to a paid plan to keep them running.",
    )
    expect(screen.getByRole("button", { name: "Upgrade" })).toBeInTheDocument()
    expect(mocks.posthog.isFeatureEnabled).toHaveBeenCalledWith(FLAG, {
      fresh: true,
    })
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
    mocks.summary.mockReturnValue({
      data: summary(0.04),
      isError: false,
      dataUpdatedAt: Date.now(),
    })
    render(view())
    expect(screen.getByTestId("trial-banner")).toBeInTheDocument()
    expect(mocks.posthog.isFeatureEnabled).not.toHaveBeenCalled()
  })

  it("uses the burn rate between two readings", () => {
    mocks.summary.mockReturnValue({
      data: summary(0.022),
      isError: false,
      dataUpdatedAt: Date.now(),
    })
    const { rerender } = render(view())
    expect(screen.getByTestId("trial-banner")).toBeInTheDocument()

    // $0.002 a minute leaves 9 minutes.
    mocks.summary.mockReturnValue({
      data: summary(0.018, T0 + 120_000),
      isError: false,
      dataUpdatedAt: Date.now(),
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

  it("starts the countdown when the browser gets the summary", () => {
    mocks.summary.mockReturnValue({
      data: summary(0.022),
      isError: false,
      dataUpdatedAt: Date.now(),
    })
    const { rerender } = render(view())
    // $0.002 a minute leaves 9 minutes. The browser clock is a minute ahead
    // of the server, which is not time used.
    vi.setSystemTime(T0 + 180_000)
    mocks.summary.mockReturnValue({
      data: summary(0.018, T0 + 120_000),
      isError: false,
      dataUpdatedAt: T0 + 180_000,
    })
    rerender(view())
    expect(screen.getByText(/runs out in/)).toHaveTextContent("about 9 minutes")
  })

  it("drops an old burn rate until the summary is read again", () => {
    mocks.summary.mockReturnValue({
      data: summary(0.022),
      isError: false,
      dataUpdatedAt: Date.now(),
    })
    const { rerender } = render(view())
    mocks.summary.mockReturnValue({
      data: summary(0.018, T0 + 120_000),
      isError: false,
      dataUpdatedAt: Date.now() - 10 * 60_000,
    })
    rerender(view())
    expect(screen.getByText(/almost used up/)).toBeInTheDocument()
    expect(screen.queryByText(/runs out in/)).toBeNull()
  })

  it("drops the burn rate when the estimate gets old", () => {
    vi.useFakeTimers({ now: Date.now(), toFake: ["Date", "setTimeout"] })
    try {
      mocks.summary.mockReturnValue({
        data: summary(0.022),
        isError: false,
        dataUpdatedAt: Date.now(),
      })
      const { rerender } = render(view())
      mocks.summary.mockReturnValue({
        data: summary(0.018, T0 + 120_000),
        isError: false,
        dataUpdatedAt: Date.now(),
      })
      rerender(view())
      expect(screen.getByText(/runs out in/)).toBeInTheDocument()
      act(() => vi.advanceTimersByTime(5 * 60_000 + 1))
      expect(screen.queryByText(/runs out in/)).toBeNull()
      expect(screen.getByText(/almost used up/)).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it("counts down on each poll", () => {
    vi.useFakeTimers({ now: Date.now(), toFake: ["Date", "setTimeout"] })
    try {
      const poll = (remaining: number, minute: number) =>
        mocks.summary.mockReturnValue({
          data: summary(remaining, T0 + minute * 60_000),
          isError: false,
          dataUpdatedAt: Date.now(),
        })
      poll(0.024, 0)
      const { rerender } = render(view())
      act(() => vi.advanceTimersByTime(60_000))
      // $0.005 a minute leaves about 4 minutes, then about 3.
      poll(0.019, 1)
      rerender(view())
      expect(screen.getByText(/about 4 minutes/)).toBeInTheDocument()
      act(() => vi.advanceTimersByTime(60_000))
      poll(0.014, 2)
      rerender(view())
      expect(screen.getByText(/about 3 minutes/)).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it("counts down between polls", () => {
    vi.useFakeTimers({ now: Date.now(), toFake: ["Date", "setTimeout"] })
    try {
      mocks.summary.mockReturnValue({
        data: summary(0.024),
        isError: false,
        dataUpdatedAt: Date.now(),
      })
      const { rerender } = render(view())
      act(() => vi.advanceTimersByTime(60_000))
      // $0.005 a minute leaves about 4 minutes.
      mocks.summary.mockReturnValue({
        data: summary(0.019, T0 + 60_000),
        isError: false,
        dataUpdatedAt: Date.now(),
      })
      rerender(view())
      expect(screen.getByText(/about 4 minutes/)).toBeInTheDocument()
      // No new poll arrives, but the shown minutes still go down.
      act(() => vi.advanceTimersByTime(31_000))
      expect(screen.getByText(/about 3 minutes/)).toBeInTheDocument()
      act(() => vi.advanceTimersByTime(3 * 60_000))
      expect(screen.getByText(/less than a minute/)).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it("shows the warning when the countdown reaches the warning time", () => {
    vi.useFakeTimers({ now: Date.now(), toFake: ["Date", "setTimeout"] })
    try {
      mocks.summary.mockReturnValue({
        data: summary(0.0345),
        isError: false,
        dataUpdatedAt: Date.now(),
      })
      const { rerender } = render(view())
      act(() => vi.advanceTimersByTime(60_000))
      // $0.003 a minute leaves 10.5 minutes, so no warning yet.
      mocks.summary.mockReturnValue({
        data: summary(0.0315, T0 + 60_000),
        isError: false,
        dataUpdatedAt: Date.now(),
      })
      rerender(view())
      expect(screen.getByTestId("trial-banner")).toBeInTheDocument()
      // No new poll arrives, but the countdown reaches 10 minutes.
      act(() => vi.advanceTimersByTime(1_000))
      act(() => vi.advanceTimersByTime(30_000))
      expect(screen.queryByTestId("trial-banner")).toBeNull()
      expect(screen.getByText(/about 10 minutes/)).toBeInTheDocument()
      expect(captured("trial_runway_warning_shown")[0]?.[1]).toMatchObject({
        minutes_left: 10,
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it("drops the countdown after the time it predicts", () => {
    vi.useFakeTimers({ now: Date.now(), toFake: ["Date", "setTimeout"] })
    try {
      mocks.summary.mockReturnValue({
        data: summary(0.0045),
        isError: false,
        dataUpdatedAt: Date.now(),
      })
      const { rerender } = render(view())
      // $0.003 a minute leaves 30 seconds.
      mocks.summary.mockReturnValue({
        data: summary(0.0015, T0 + 60_000),
        isError: false,
        dataUpdatedAt: Date.now(),
      })
      rerender(view())
      expect(screen.getByText(/less than a minute/)).toBeInTheDocument()
      act(() => vi.advanceTimersByTime(30_001))
      expect(screen.queryByText(/runs out in/)).toBeNull()
      expect(screen.getByText(/almost used up/)).toBeInTheDocument()
      fireEvent.click(screen.getByRole("button", { name: "Upgrade" }))
      expect(captured("trial_runway_warning_clicked")[0]?.[1]).toMatchObject({
        minutes_left: null,
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it("hides the warning when nothing uses credit", () => {
    const { rerender } = render(view())
    expect(screen.queryByTestId("trial-banner")).toBeNull()
    mocks.summary.mockReturnValue({
      data: summary(0.015, T0 + 60_000),
      isError: false,
      dataUpdatedAt: Date.now(),
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
    fireEvent.click(screen.getByRole("button", { name: "Upgrade" }))
    expect(captured("trial_runway_warning_clicked")).toHaveLength(1)
    expect(captured("trial_runway_warning_clicked")[0]?.[1]).toMatchObject({
      remaining_usd: 0.015,
      threshold_mode: "fixed",
      target: "checkout",
    })
  })

  it("asks a member without billing access to contact an administrator", () => {
    mocks.summary.mockReturnValue({
      data: summary(0.015, T0, {
        permissions: { can_view: true, can_manage: false },
      }),
      isError: false,
      dataUpdatedAt: Date.now(),
    })
    render(view())
    expect(screen.queryByRole("button")).toBeNull()
    expect(
      screen.getByText(/billing administrator to upgrade/),
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
