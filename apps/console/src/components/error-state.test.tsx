import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { ErrorState } from "./error-state"

describe("ErrorState accessibility", () => {
  it("keeps suggestion text readable", () => {
    render(<ErrorState suggestion="Check your connection and try again." />)

    const suggestion = screen.getByText("Check your connection and try again.")
    expect(suggestion).toHaveClass("text-muted")
    expect(suggestion.className).not.toMatch(/text-muted\//)
  })
})
