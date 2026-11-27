import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { GOOGLE_SIGNUP_RECOVERY_URL, ApiError } from "@/lib/api/client"

import RootError from "./error"

describe("RootError", () => {
  afterEach(() => vi.restoreAllMocks())

  it("offers a reload for an error that escaped the page", () => {
    const reload = vi.fn()
    vi.spyOn(window, "location", "get").mockReturnValue({
      ...window.location,
      reload,
    })
    render(<RootError error={new Error("NotFoundError: removeChild")} />)

    expect(screen.getByText("This page couldn't load")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /try again|retry/i }))
    expect(reload).toHaveBeenCalledOnce()
  })
})

describe("RootError signup recovery", () => {
  it("keeps the Google signup way out from the dashboard boundary", () => {
    render(
      <RootError
        error={new ApiError(403, "google_signup_recovery_required", "x")}
      />,
    )
    expect(
      screen.getByRole("link", { name: "Complete signup with Google" }),
    ).toHaveAttribute("href", GOOGLE_SIGNUP_RECOVERY_URL)
    expect(screen.queryByText("This page couldn't load")).toBeNull()
  })
})
