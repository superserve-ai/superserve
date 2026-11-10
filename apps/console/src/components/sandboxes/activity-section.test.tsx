import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { ActivityResponse } from "@/lib/api/types"

import { ActivitySection } from "./activity-section"

const mocks = vi.hoisted(() => ({ summary: vi.fn(), capture: vi.fn() }))
vi.mock("@/hooks/use-billing-summary", () => ({
  useBillingSummary: mocks.summary,
}))
vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: mocks.capture }),
}))

const entry = (action: string): ActivityResponse => ({
  id: `a-${action}`,
  sandbox_id: "sbx-1",
  template_id: null,
  category: "sandbox",
  action,
  status: "success",
  sandbox_name: "box",
  secret_id: null,
  secret_name: null,
  actor_id: null,
  duration_ms: null,
  error: null,
  metadata: {},
  created_at: "2026-11-09T09:49:00.000Z",
})

describe("ActivitySection", () => {
  it("shows activity query failures instead of an empty state", () => {
    const onRetry = vi.fn()

    render(
      <ActivitySection
        activity={undefined}
        isPending={false}
        error={
          new Error(
            "Forbidden: platform activity read access required while viewing another team",
          )
        }
        onRetry={onRetry}
      />,
    )

    expect(screen.getByText("Unable to load activity")).toBeInTheDocument()
    expect(
      screen.getByText(/platform activity read access required/i),
    ).toBeInTheDocument()
    expect(screen.queryByText("No Activity")).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Try Again" }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it("keeps the empty state for successful empty results", () => {
    render(<ActivitySection activity={[]} isPending={false} error={null} />)

    expect(screen.getByText("No Activity")).toBeInTheDocument()
    expect(
      screen.queryByText("Unable to load activity"),
    ).not.toBeInTheDocument()
  })

  it("shows a billing pause in plain words with the plan action while blocked", () => {
    mocks.summary.mockReturnValue({
      data: { trial_block: "trial_exhausted", permissions: {} },
    })
    render(
      <ActivitySection
        activity={[entry("billing_ineligible_paused")]}
        isPending={false}
        error={null}
      />,
    )

    expect(
      screen.getByText("Paused: trial credit used up or no plan"),
    ).toBeInTheDocument()
    expect(
      screen.queryByText("billing_ineligible_paused"),
    ).not.toBeInTheDocument()
    const link = screen.getByRole("link", { name: "Add card / choose plan" })
    expect(link).toHaveAttribute("href", "/billing-usage/")
    link.addEventListener("click", (event) => event.preventDefault())
    fireEvent.click(link)
    expect(mocks.capture).toHaveBeenCalledWith("billing_block_action_clicked", {
      reason: "trial_used_up",
      code: "trial_exhausted",
      surface: "activity",
    })
  })

  it("hides the plan action once the team can run sandboxes again", () => {
    mocks.summary.mockReturnValue({
      data: { trial_block: null, plan: { status: "active" }, permissions: {} },
    })
    render(
      <ActivitySection
        activity={[entry("billing_ineligible_paused")]}
        isPending={false}
        error={null}
      />,
    )

    expect(
      screen.getByText("Paused: trial credit used up or no plan"),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("link", { name: "Add card / choose plan" }),
    ).not.toBeInTheDocument()
  })

  it("keeps other actions as they are", () => {
    mocks.summary.mockClear()
    render(
      <ActivitySection
        activity={[entry("timeout_paused")]}
        isPending={false}
        error={null}
      />,
    )
    expect(screen.getByText("timeout_paused")).toBeInTheDocument()
    expect(mocks.summary).not.toHaveBeenCalled()
  })
})
