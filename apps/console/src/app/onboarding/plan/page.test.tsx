import { act, render, screen } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"

const m = vi.hoisted(() => ({ resolve: vi.fn() }))
vi.mock("@/lib/api/signup-plan-page", () => ({ getSignupPlanPage: m.resolve }))
vi.mock("@/components/onboarding/plan-selection-loader", () => ({
  PlanSelectionLoader: ({ initialContext }: { initialContext: unknown }) => (
    <p>{initialContext ? "Plan choices" : "Retry setup"}</p>
  ),
}))
vi.mock("next/server", () => ({ after: vi.fn() }))
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`)
  },
}))
import Page from "./page"

beforeEach(() => vi.clearAllMocks())

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
