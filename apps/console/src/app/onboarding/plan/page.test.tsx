import { act, render, screen } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"

const m = vi.hoisted(() => ({
  resolve: vi.fn(),
  after: vi.fn<(callback: () => Promise<void>) => void>(),
  track: vi.fn(),
}))
vi.mock("@/lib/api/signup-plan-page", () => ({ getSignupPlanPage: m.resolve }))
vi.mock("@/components/onboarding/plan-selection-loader", () => ({
  PlanSelectionLoader: ({ initialContext }: { initialContext: unknown }) => (
    <p>{initialContext ? "Plan choices" : "Retry setup"}</p>
  ),
}))
vi.mock("next/server", () => ({ after: m.after }))
vi.mock("@/lib/posthog/actions", () => ({ trackEvent: m.track }))
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`)
  },
}))
import Page from "./page"

beforeEach(() => vi.clearAllMocks())

async function redirectAndTrack(billing?: string) {
  await expect(
    Page({ searchParams: Promise.resolve({ billing }) }),
  ).rejects.toThrow("redirect:/sandboxes")
  expect(m.after).toHaveBeenCalledTimes(1)
  expect(m.track).not.toHaveBeenCalled()
  await m.after.mock.calls[0][0]()
}

it("does not render an intermediate page while the server check is pending", async () => {
  let resolve!: (value: unknown) => void
  m.resolve.mockReturnValue(
    new Promise((r) => {
      resolve = r
    }),
  )
  const settled = vi.fn()
  const page = Page({ searchParams: Promise.resolve({}) }).then((value) => {
    settled()
    return value
  })
  await act(async () => {})
  expect(settled).not.toHaveBeenCalled()
  resolve({
    context: {
      userId: "owner",
      teamKey: "use:team",
      state: "selecting",
      offer: null,
    },
  })
  render(await page)
  expect(screen.getByText("Plan choices")).toBeVisible()
})

it.each([
  ["legacy", null, undefined, true],
  ["committed", "pro_annual", "success", true],
  ["committed", "free", "success", true],
  ["committed", "free", "cancel", false],
  ["pending", "pro_monthly", "success", false],
])(
  "routes %s / %s / %s without losing payment recovery",
  async (state, offer, billing, finished) => {
    m.resolve.mockResolvedValue({
      context: { userId: "owner", teamKey: "use:team", state, offer },
    })
    const page = Page({
      searchParams: Promise.resolve({ billing: billing ?? undefined }),
    })
    if (finished) await expect(page).rejects.toThrow("redirect:/sandboxes")
    else {
      render(await page)
      expect(screen.getByText("Plan choices")).toBeVisible()
    }
  },
)

it("tracks a trial team as skipped without a selected plan", async () => {
  m.resolve.mockResolvedValue({
    context: {
      userId: "owner",
      teamKey: "use:team",
      state: "legacy",
      offer: null,
      requestedOffer: "pro_annual",
      entryState: "trial",
    },
  })
  await redirectAndTrack()
  expect(m.track.mock.calls).toEqual([
    [
      "signup_plan_action",
      "owner",
      {
        action: "skipped",
        requested_offer: "pro_annual",
        entry_state: "trial",
      },
    ],
  ])
})

it.each([
  [{ paymentSettling: true }, "activating"],
  [{ planAssigned: true }, "plan_assigned"],
  [{}, "legacy"],
])("tracks legacy context %j as %s", async (flags, entryState) => {
  m.resolve.mockResolvedValue({
    context: {
      userId: "owner",
      teamKey: "use:team",
      state: "legacy",
      offer: null,
      ...flags,
    },
  })
  await redirectAndTrack()
  expect(m.track.mock.calls).toEqual([
    [
      "signup_plan_action",
      "owner",
      {
        action: "skipped",
        requested_offer: "not_specified",
        entry_state: entryState,
      },
    ],
  ])
})

it("tracks only skipped when a legacy team returns from billing", async () => {
  m.resolve.mockResolvedValue({
    context: {
      userId: "owner",
      teamKey: "use:team",
      state: "legacy",
      offer: null,
    },
  })
  await redirectAndTrack("success")
  expect(m.track.mock.calls).toEqual([
    [
      "signup_plan_action",
      "owner",
      {
        action: "skipped",
        requested_offer: "not_specified",
        entry_state: "legacy",
        billing_return: "success",
      },
    ],
  ])
})

it("tracks checkout returned then completed for a committed annual plan", async () => {
  m.resolve.mockResolvedValue({
    context: {
      userId: "owner",
      teamKey: "use:team",
      state: "committed",
      offer: "pro_annual",
      requestedOffer: "pro_annual",
    },
  })
  await redirectAndTrack("success")
  expect(m.track.mock.calls).toEqual([
    [
      "signup_plan_action",
      "owner",
      {
        action: "checkout_returned",
        requested_offer: "pro_annual",
        selected_offer: "pro_annual",
        billing_cadence: "annual",
      },
    ],
    [
      "signup_plan_action",
      "owner",
      {
        action: "completed",
        requested_offer: "pro_annual",
        selected_offer: "pro_annual",
        billing_cadence: "annual",
      },
    ],
  ])
})

it("tracks only completed for a committed free plan without billing", async () => {
  m.resolve.mockResolvedValue({
    context: {
      userId: "owner",
      teamKey: "use:team",
      state: "committed",
      offer: "free",
    },
  })
  await redirectAndTrack()
  expect(m.track.mock.calls).toEqual([
    [
      "signup_plan_action",
      "owner",
      {
        action: "completed",
        requested_offer: "not_specified",
        selected_offer: "free",
        billing_cadence: undefined,
      },
    ],
  ])
})
