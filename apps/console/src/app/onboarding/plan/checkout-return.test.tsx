import { beforeEach, expect, it, vi } from "vitest"

const m = vi.hoisted(() => ({
  resolve: vi.fn(),
  returned: vi.fn(),
  completed: vi.fn(),
}))
vi.mock("@/lib/api/signup-plan-page", () => ({ getSignupPlanPage: m.resolve }))
vi.mock("@/components/onboarding/plan-selection-loader", () => ({
  PlanSelectionLoader: () => null,
}))
vi.mock("@/lib/posthog/checkout", async (importOriginal) => ({
  parseTeamKey: (
    await importOriginal<typeof import("@/lib/posthog/checkout")>()
  ).parseTeamKey,
  recordCheckoutReturned: m.returned,
  recordCheckoutCompleted: m.completed,
}))
vi.mock("next/server", () => ({ after: vi.fn() }))
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`)
  },
}))

import Page from "./page"

const TEAM_ID = "11111111-1111-4111-8111-111111111111"
const context = (state: string, offer: string | null) => ({
  context: { userId: "owner", teamKey: `use:${TEAM_ID}`, state, offer },
})

beforeEach(() => vi.clearAllMocks())

it("records a cancelled Checkout for the onboarding team", async () => {
  m.resolve.mockResolvedValue(context("selecting", null))
  await Page({ searchParams: Promise.resolve({ billing: "cancel" }) })
  expect(m.returned).toHaveBeenCalledWith({
    userId: "owner",
    surface: "onboarding_plan",
    outcome: "cancel",
    teamKey: `use:${TEAM_ID}`,
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

it("records nothing for a Free plan's card setup return", async () => {
  m.resolve.mockResolvedValue(context("selecting", "free"))
  await Page({ searchParams: Promise.resolve({ billing: "cancel" }) })
  m.resolve.mockResolvedValue(context("committed", "free"))
  await expect(
    Page({ searchParams: Promise.resolve({ billing: "success" }) }),
  ).rejects.toThrow("redirect:/sandboxes")
  expect(m.returned).not.toHaveBeenCalled()
  expect(m.completed).not.toHaveBeenCalled()
})

it("records nothing without a Checkout return or a resolved team", async () => {
  m.resolve.mockResolvedValue(context("selecting", null))
  await Page({ searchParams: Promise.resolve({}) })
  await Page({ searchParams: Promise.resolve({ billing: "other" }) })
  m.resolve.mockResolvedValue(null)
  await Page({ searchParams: Promise.resolve({ billing: "success" }) })
  expect(m.returned).not.toHaveBeenCalled()
})

it("completes a paid Checkout that committed before the return rendered", async () => {
  m.resolve.mockResolvedValue(context("committed", "pro_monthly"))
  await expect(
    Page({ searchParams: Promise.resolve({ billing: "success" }) }),
  ).rejects.toThrow("redirect:/sandboxes")
  expect(m.completed).toHaveBeenCalledWith({
    userId: "owner",
    surface: "onboarding_plan",
    team: { region: "use", teamId: TEAM_ID },
  })
})

it("completes nothing for a free plan, a legacy team or a plain visit", async () => {
  m.resolve.mockResolvedValue(context("committed", "free"))
  await expect(
    Page({ searchParams: Promise.resolve({ billing: "success" }) }),
  ).rejects.toThrow("redirect:/sandboxes")
  m.resolve.mockResolvedValue(context("legacy", null))
  await expect(
    Page({ searchParams: Promise.resolve({ billing: "success" }) }),
  ).rejects.toThrow("redirect:/sandboxes")
  m.resolve.mockResolvedValue(context("committed", "pro_monthly"))
  await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow(
    "redirect:/sandboxes",
  )
  expect(m.completed).not.toHaveBeenCalled()
})
