import { render } from "@testing-library/react"
import { expect, it } from "vitest"

import SettingsLoading from "./loading"

it("uses the Settings container layout for both skeleton sections", () => {
  const { container } = render(<SettingsLoading />)
  const scrollArea = container.querySelector(".overflow-y-auto")
  const sections = container.querySelectorAll(".overflow-y-auto > .grid")

  expect(scrollArea).toHaveClass("@container")
  expect(sections).toHaveLength(2)
  for (const section of sections) {
    expect(section).toHaveClass("@2xl:grid-cols-[240px_minmax(0,1fr)]")
    expect(section).not.toHaveClass("grid-cols-[240px_1fr]")
  }
})
