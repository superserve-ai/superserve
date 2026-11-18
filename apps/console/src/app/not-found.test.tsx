import { render, screen } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"

vi.mock("next/image", () => ({
  default: ({ alt }: { alt: string }) => <span>{alt}</span>,
}))

import NotFound, { metadata } from "./not-found"

afterEach(() => vi.unstubAllEnvs())

it("explains the missing page and links back to the console", () => {
  // Match Next's trailingSlash setting when rendering Link in Vitest.
  vi.stubEnv("__NEXT_TRAILING_SLASH", "true")
  expect(metadata.title).toBe("Page not found")
  render(<NotFound />)
  expect(screen.getByRole("main")).toBeInTheDocument()
  expect(
    screen.getByRole("heading", { name: "Page not found" }),
  ).toBeInTheDocument()
  expect(screen.getByText("404")).toBeInTheDocument()
  expect(screen.getByRole("link", { name: "Back to console" })).toHaveAttribute(
    "href",
    "/sandboxes/",
  )
})
