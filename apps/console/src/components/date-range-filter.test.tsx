import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { DateRangeFilter, parseDateInput } from "./date-range-filter"

describe("DateRangeFilter", () => {
  // The calendar opens on the current month (`new Date()`), and the inverted-range
  // test clicks hardcoded June 2026 days. Pin the clock to mid-June 2026 so those
  // days always render, regardless of when the suite runs. Fake only `Date` —
  // userEvent relies on real timers.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-06-15T12:00:00Z"))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("rejects invalid calendar dates", () => {
    expect(parseDateInput("2026-02-30")).toBeNull()
    expect(parseDateInput("2026-13-01")).toBeNull()
  })

  it("displays the inclusive end date for custom ranges", () => {
    render(
      <DateRangeFilter
        value={{
          start: new Date("2026-06-01T00:00:00"),
          end: new Date("2026-06-03T00:00:00"),
        }}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByText("Jun 1 – Jun 2")).toBeInTheDocument()
    expect(
      screen.getByRole("button", {
        name: "Custom date range: Jun 1 to Jun 2",
      }),
    ).toBeInTheDocument()
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

  it.each([
    ["7D", "2026-06-08", "Jun 8"],
    ["30D", "2026-05-16", "May 16"],
  ])(
    "keeps exclusive custom ends distinct from %s",
    async (label, start, displayStart) => {
      vi.setSystemTime(new Date("2026-06-15T12:00:00"))
      const user = userEvent.setup()
      const onChange = vi.fn()
      const { rerender } = render(
        <DateRangeFilter
          value={{
            start: new Date(`${start}T00:00:00`),
            end: new Date("2026-06-15T00:00:00"),
          }}
          onChange={onChange}
        />,
      )

      expect(screen.getByText(`${displayStart} – Jun 14`)).toBeInTheDocument()
      expect(
        screen.getByRole("button", {
          name: `Custom date range: ${displayStart} to Jun 14`,
        }),
      ).toHaveClass("bg-brand/10")
      expect(screen.getByRole("button", { name: label })).not.toHaveClass(
        "bg-brand/10",
      )

      await user.click(screen.getByRole("button", { name: label }))
      const rollingRange = {
        start: new Date(`${start}T00:00:00`),
        end: new Date("2026-06-15T12:00:00"),
      }
      expect(onChange).toHaveBeenLastCalledWith(rollingRange)

      // A later render must still recognize the selected rolling preset.
      vi.setSystemTime(new Date("2026-06-15T12:01:00"))
      rerender(<DateRangeFilter value={rollingRange} onChange={onChange} />)
      expect(screen.getByRole("button", { name: label })).toHaveClass(
        "bg-brand/10",
      )
      expect(
        screen.getByRole("button", {
          name: "Select a custom date range",
        }),
      ).toBeInTheDocument()
      await user.click(screen.getByRole("button", { name: label }))
      expect(onChange).toHaveBeenLastCalledWith(null)
    },
  )

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
