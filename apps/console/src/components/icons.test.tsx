import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { Spinner } from "./icons"

describe("Spinner", () => {
  it.each([
    { className: undefined, borderClass: "border-white" },
    { className: "border-primary", borderClass: "border-primary" },
  ])(
    "keeps the ring and gates rotation with $borderClass",
    ({ className, borderClass }) => {
      render(<Spinner className={className} />)
      const spinner = screen.getByRole("status", { name: "Loading" })

      expect(spinner.tagName).toBe("OUTPUT")
      expect(screen.getByText("Loading")).toHaveClass("sr-only")
      expect(spinner).toHaveClass(
        `block h-5 w-5 rounded-full border-2 border-t-transparent motion-safe:animate-[spin_0.8s_linear_infinite] ${borderClass}`,
        { exact: true },
      )
      expect(
        Array.from(spinner.classList).filter(
          (className) =>
            /(?:^|:)animate-/.test(className) &&
            !className.split(":").includes("motion-safe"),
        ),
      ).toEqual([])
    },
  )

  it("merges size and color overrides for a small dialog spinner", () => {
    render(<Spinner className="h-4 w-4 border-current" />)
    const spinner = screen.getByRole("status", { name: "Loading" })

    expect(spinner).toHaveClass("h-4 w-4 border-current border-t-transparent")
    for (const className of ["h-5", "w-5", "border-white"]) {
      expect(spinner).not.toHaveClass(className)
    }
  })

  it("preserves an existing caller's top border color", () => {
    render(<Spinner className="border-foreground/20 border-t-foreground" />)

    expect(screen.getByRole("status", { name: "Loading" })).toHaveClass(
      "border-foreground/20 border-t-foreground",
    )
  })
})
