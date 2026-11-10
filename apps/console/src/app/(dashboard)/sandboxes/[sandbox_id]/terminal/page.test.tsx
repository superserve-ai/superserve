import { act, fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "@/lib/api/client"

const mocks = vi.hoisted(() => ({
  sandbox: vi.fn(),
  resume: vi.fn(),
  resumeOptions: vi.fn(),
  summary: vi.fn(),
  capture: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  useParams: () => ({ sandbox_id: "sbx-1" }),
  useRouter: () => ({ back: vi.fn() }),
}))
vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: mocks.capture }),
}))
vi.mock("@/components/corner-brackets", () => ({ CornerBrackets: () => null }))
vi.mock("@/components/sandboxes/terminal-tabs", () => ({
  TerminalTabs: () => <div>terminal</div>,
}))
vi.mock("@/hooks/use-billing-summary", () => ({
  useBillingSummary: mocks.summary,
}))
vi.mock("@/hooks/use-sandboxes", () => ({
  useSandbox: mocks.sandbox,
  useResumeSandbox: (options: unknown) => {
    mocks.resumeOptions(options)
    return mocks.resume()
  },
}))

import TerminalPage from "./page"

const paused = {
  data: { id: "sbx-1", name: "box", status: "paused", access_token: "t" },
  isPending: false,
  error: null,
  refetch: vi.fn(),
}

describe("TerminalPage billing block", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.sandbox.mockReturnValue(paused)
    mocks.summary.mockReturnValue({ data: undefined })
    mocks.resume.mockReturnValue({
      mutate: vi.fn(),
      reset: vi.fn(),
      isPending: false,
      error: null,
    })
  })

  it("offers Start again once a newer billing summary shows the team unblocked", () => {
    const mutate = vi.fn()
    const reset = vi.fn()
    const error = new ApiError(402, "trial_check_unavailable", "")
    mocks.resume.mockReturnValue({
      mutate,
      reset,
      isPending: false,
      error: null,
    })
    mocks.summary.mockReturnValue({ data: undefined, dataUpdatedAt: 0 })
    const view = render(<TerminalPage />)

    fireEvent.click(screen.getByRole("button", { name: "Start sandbox" }))
    const [, options] = mutate.mock.calls[0]
    const failedAt = Date.now()
    act(() => options.onError(error))
    mocks.resume.mockReturnValue({ mutate, reset, isPending: false, error })
    view.rerender(<TerminalPage />)
    expect(screen.getByText("Free trial not confirmed")).toBeInTheDocument()

    // A summary from before the failure does not clear it.
    mocks.summary.mockReturnValue({
      data: { trial_block: null, plan: { status: "active" } },
      dataUpdatedAt: failedAt - 1_000,
    })
    view.rerender(<TerminalPage />)
    expect(reset).not.toHaveBeenCalled()

    // A newer summary that still shows a block does not clear it either.
    mocks.summary.mockReturnValue({
      data: { trial_block: null, plan: { status: "trial_ended" } },
      dataUpdatedAt: failedAt + 1_000,
    })
    view.rerender(<TerminalPage />)
    expect(reset).not.toHaveBeenCalled()

    mocks.summary.mockReturnValue({
      data: { trial_block: null, plan: { status: "active" } },
      dataUpdatedAt: failedAt + 2_000,
    })
    view.rerender(<TerminalPage />)
    expect(reset).toHaveBeenCalledOnce()
  })

  it("offers Start for a paused sandbox when billing is fine", () => {
    render(<TerminalPage />)
    expect(screen.getByText("Sandbox is paused")).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Start sandbox" }),
    ).toBeInTheDocument()
    expect(mocks.resumeOptions).toHaveBeenCalledWith({
      billingBlockToast: false,
    })
  })

  it("shows the upgrade state, not a crash, when Start returns a trial 402", () => {
    const assign = vi.fn()
    vi.spyOn(window, "location", "get").mockReturnValue({
      ...window.location,
      origin: "https://console.superserve.ai",
      assign,
    })
    mocks.resume.mockReturnValue({
      mutate: vi.fn(),
      reset: vi.fn(),
      isPending: false,
      error: new ApiError(
        402,
        "trial_exhausted",
        "Your free trial credit is used up. Add a card and choose a plan to keep using sandboxes: https://console.superserve.ai/plan-usage",
        "https://console.superserve.ai/plan-usage",
      ),
    })

    render(<TerminalPage />)

    expect(screen.getByText("Free trial credit used up")).toBeInTheDocument()
    expect(screen.queryByText("Sandbox is paused")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^start/i })).toBeNull()
    expect(mocks.capture).toHaveBeenCalledWith("billing_block_shown", {
      reason: "trial_used_up",
      code: "trial_exhausted",
      surface: "terminal",
    })

    fireEvent.click(
      screen.getByRole("button", { name: "Add card / choose plan" }),
    )
    expect(assign).toHaveBeenCalledWith("/billing-usage/")
    vi.restoreAllMocks()
  })

  it.each([
    ["trial_unavailable", "Free trial not available"],
    ["trial_check_unavailable", "Free trial not confirmed"],
  ])("shows the %s state from the billing summary", (code, title) => {
    mocks.summary.mockReturnValue({ data: { trial_block: code } })
    render(<TerminalPage />)
    expect(screen.getByText(title)).toBeInTheDocument()
  })

  it("keeps the terminal for a running sandbox", () => {
    mocks.sandbox.mockReturnValue({
      ...paused,
      data: { ...paused.data, status: "active" },
    })
    mocks.summary.mockReturnValue({ data: { trial_block: "trial_exhausted" } })
    render(<TerminalPage />)
    expect(screen.getByText("terminal")).toBeInTheDocument()
  })
})
