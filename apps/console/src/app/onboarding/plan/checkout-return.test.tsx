import { beforeEach, expect, it, vi } from "vitest"

const m = vi.hoisted(() => ({ resolve: vi.fn(), returned: vi.fn() }))
vi.mock("@/lib/api/signup-plan-page", () => ({ getSignupPlanPage: m.resolve }))
vi.mock("@/components/onboarding/plan-selection-loader", () => ({
  PlanSelectionLoader: () => null,
}))
vi.mock("@/lib/posthog/checkout", () => ({
  recordCheckoutReturned: m.returned,
}))
vi.mock("next/server", () => ({ after: vi.fn() }))
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`)
  },
}))

import Page from "./page"

const context = (state: string, offer: string | null) => ({
  context: { userId: "owner", teamKey: "use:team", state, offer },
})

beforeEach(() => vi.clearAllMocks())

it("records a cancelled Checkout for the onboarding team", async () => {
  m.resolve.mockResolvedValue(context("selecting", null))
  await Page({ searchParams: Promise.resolve({ billing: "cancel" }) })
  expect(m.returned).toHaveBeenCalledWith({
    userId: "owner",
    surface: "onboarding_plan",
    outcome: "cancel",
    teamKey: "use:team",
  })
})

it("records a successful return before the paid team is sent on", async () => {
  m.resolve.mockResolvedValue(context("committed", "pro_monthly"))
  await expect(
    Page({ searchParams: Promise.resolve({ billing: "success" }) }),
  ).rejects.toThrow("redirect:/sandboxes")
  expect(m.returned).toHaveBeenCalledWith(
    expect.objectContaining({ outcome: "success" }),
  )
})

it("records nothing without a Checkout return or a resolved team", async () => {
  m.resolve.mockResolvedValue(context("selecting", null))
  await Page({ searchParams: Promise.resolve({}) })
  await Page({ searchParams: Promise.resolve({ billing: "other" }) })
  m.resolve.mockResolvedValue(null)
  await Page({ searchParams: Promise.resolve({ billing: "success" }) })
  expect(m.returned).not.toHaveBeenCalled()
})
