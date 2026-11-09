import { render, screen } from "@testing-library/react"
import { expect, it, vi } from "vitest"

vi.mock("next/image", () => ({
  default: ({ alt }: { alt: string }) => <span>{alt}</span>,
}))

import NotFound from "./not-found"

it("explains the missing page and links back to the console", () => {
  render(<NotFound />)
  expect(screen.getByRole("main")).toBeInTheDocument()
  expect(
    screen.getByRole("heading", { name: "Page not found" }),
  ).toBeInTheDocument()
  expect(screen.getByText("404")).toBeInTheDocument()
  expect(screen.getByRole("link", { name: "Back to console" })).toHaveAttribute(
    "href",
    "/",
  )
})
