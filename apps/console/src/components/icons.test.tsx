import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { Spinner } from "./icons"

describe("Spinner", () => {
  it.each([
    { className: undefined, borderClass: "border-white" },
    { className: "border-primary", borderClass: "border-primary" },
  ])(
    "keeps the ring and gates rotation with $borderClass",
    ({ className, borderClass }) => {
      const { container } = render(<Spinner className={className} />)
      const spinner = container.firstElementChild

      expect(spinner?.tagName).toBe("DIV")
      expect(spinner).toHaveClass(
        `h-5 w-5 rounded-full border-2 border-t-transparent motion-safe:animate-[spin_0.8s_linear_infinite] ${borderClass}`,
        { exact: true },
      )
      expect(
        Array.from(spinner?.classList ?? []).filter(
          (className) =>
            /(?:^|:)animate-/.test(className) &&
            !className.split(":").includes("motion-safe"),
        ),
      ).toEqual([])
    },
  )
})
