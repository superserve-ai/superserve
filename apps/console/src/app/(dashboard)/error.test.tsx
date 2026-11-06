import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { ApiError, GOOGLE_SIGNUP_RECOVERY_URL } from "@/lib/api/client"

import DashboardError from "./error"

describe("DashboardError", () => {
  it("shows default copy, logs diagnostics, and retries via reset", () => {
    const error = Object.assign(
      new Error(
        "An error occurred in the Server Components render. The specific message is omitted in production builds to avoid leaking sensitive details.",
      ),
      { digest: "dashboard-error-digest" },
    )
    const reset = vi.fn()

    render(<DashboardError error={error} reset={reset} />)

    expect(screen.getByText("Something went wrong")).toBeInTheDocument()
    expect(
      screen.getByText(
        "An error occurred while loading data. Please try again.",
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(error.message)).not.toBeInTheDocument()
    expect(screen.queryByText(error.digest)).not.toBeInTheDocument()
    expect(console.error).toHaveBeenCalledExactlyOnceWith(
      "Something went wrong",
      {
        error,
        digest: error.digest,
      },
    )

    fireEvent.click(screen.getByRole("button", { name: "Try Again" }))
    expect(reset).toHaveBeenCalledOnce()
  })

  it("keeps the Google signup recovery link", () => {
    const error = new ApiError(
      403,
      "google_signup_recovery_required",
      "Complete Google signup to continue",
    )

    render(<DashboardError error={error} reset={vi.fn()} />)

    expect(
      screen.getByRole("link", { name: "Complete signup with Google" }),
    ).toHaveAttribute("href", GOOGLE_SIGNUP_RECOVERY_URL)
  })
})
