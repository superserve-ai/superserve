import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { DateRangeFilter, parseDateInput } from "./date-range-filter"

describe("DateRangeFilter", () => {
  it("rejects invalid calendar dates", () => {
    expect(parseDateInput("2026-02-30")).toBeNull()
    expect(parseDateInput("2026-13-01")).toBeNull()
  })

  it("rejects invalid custom ranges without calling onChange", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(<DateRangeFilter value={null} onChange={onChange} />)

    await user.click(
      screen.getByRole("button", { name: "Select a custom date range" }),
    )
    await user.click(screen.getByRole("button", { name: "Apply" }))

    expect(onChange).not.toHaveBeenCalled()
  })

  it("rejects an inverted range without calling onChange", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(<DateRangeFilter value={null} onChange={onChange} />)

    await user.click(
      screen.getByRole("button", { name: "Select a custom date range" }),
    )
    await user.click(screen.getByRole("button", { name: "Tue Jun 02 2026" }))
    await user.click(screen.getByRole("button", { name: "Mon Jun 01 2026" }))
    await user.click(screen.getByRole("button", { name: "Apply" }))

    expect(onChange).not.toHaveBeenCalled()
    expect(
      screen.getByText("End date must be on or after the start date."),
    ).toBeInTheDocument()
  })
})
