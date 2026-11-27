import { render, screen } from "@testing-library/react"
import { StrictMode } from "react"
import { describe, expect, it, vi } from "vitest"

import { ApiError } from "@/lib/api/client"

import { ErrorState, errorStateMessage } from "./error-state"

describe("ErrorState", () => {
  it("shows default copy and logs each error once with its digest", () => {
    const error = Object.assign(new Error("signal is aborted without reason"), {
      digest: "next-error-digest",
    })
    const consoleError = vi.mocked(console.error)
    const { rerender } = render(
      <StrictMode>
        <ErrorState error={error} />
      </StrictMode>,
    )

    expect(screen.getByText("Something went wrong")).toBeInTheDocument()
    expect(
      screen.getByText(
        "An error occurred while loading data. Please try again.",
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(error.message)).not.toBeInTheDocument()
    expect(screen.queryByText(error.digest)).not.toBeInTheDocument()
    expect(consoleError).toHaveBeenCalledExactlyOnceWith(
      "Something went wrong",
      {
        error,
        digest: error.digest,
      },
    )

    rerender(
      <StrictMode>
        <ErrorState error={error} />
      </StrictMode>,
    )

    expect(consoleError).toHaveBeenCalledOnce()

    const nextError = new Error(error.message)
    rerender(
      <StrictMode>
        <ErrorState title="Unable to load data" error={nextError} />
      </StrictMode>,
    )

    expect(consoleError).toHaveBeenCalledTimes(2)
    expect(consoleError).toHaveBeenLastCalledWith("Unable to load data", {
      error: nextError,
      digest: undefined,
    })

    rerender(
      <StrictMode>
        <ErrorState error={error} />
      </StrictMode>,
    )

    expect(consoleError).toHaveBeenCalledTimes(2)
  })

  it("keeps a non-Error diagnostic value out of the rendered copy", () => {
    const error = "raw network failure"

    render(<ErrorState error={error} />)

    expect(screen.queryByText(error)).not.toBeInTheDocument()
    expect(screen.getByText("Something went wrong")).toBeInTheDocument()
    expect(console.error).toHaveBeenCalledExactlyOnceWith(
      "Something went wrong",
      {
        error,
        digest: undefined,
      },
    )
  })

  it("does not log when no error is provided", () => {
    render(<ErrorState />)

    expect(console.error).not.toHaveBeenCalled()
  })
})

describe("errorStateMessage", () => {
  it.each([
    ["undefined", undefined],
    ["null", null],
    ["ApiError 404", new ApiError(404, "not_found", "raw server message")],
  ])("returns not-found copy for %s", (_label, error) => {
    expect(errorStateMessage(error, "Sandbox not found")).toBe(
      "Sandbox not found",
    )
  })

  it.each([
    ["ApiError 500", new ApiError(500, "internal_error", "raw server message")],
    ["plain Error", new Error("raw server message")],
    ["other object with status 404", { status: 404 }],
  ])("returns generic copy for %s", (_label, error) => {
    expect(errorStateMessage(error, "Sandbox not found")).toBe(
      "An error occurred while loading data. Please try again.",
    )
  })
})
