import { fireEvent, render, screen } from "@testing-library/react"
import { expect, it, vi } from "vitest"

vi.mock("next/image", () => ({
  default: ({ alt }: { alt: string }) => <span>{alt}</span>,
}))
vi.mock("next/font/google", () => ({
  Instrument_Sans: () => ({ variable: "sans-font" }),
  Geist_Mono: () => ({ variable: "mono-font" }),
}))

import GlobalError from "./global-error"

// global-error renders its own <html>, so it mounts on the document. Keep it
// the only render in this file: React skips event setup on a document that an
// earlier root already marked.
it("retries and links back without showing the raw error", () => {
  const reset = vi.fn()
  render(
    <GlobalError error={new Error("secret stack detail")} reset={reset} />,
    {
      container: document,
    },
  )
  expect(
    screen.getByRole("heading", { name: "Console failed to load" }),
  ).toBeInTheDocument()
  expect(document.title).toBe("Console failed to load | Superserve")
  expect(
    screen.getByText(
      "Try again. If it fails again, reload the console from the start.",
    ),
  ).toBeInTheDocument()
  expect(screen.queryByText(/secret stack detail/)).toBeNull()
  expect(screen.getByRole("link", { name: "Back to console" })).toHaveAttribute(
    "href",
    "/sandboxes/",
  )
  fireEvent.click(screen.getByRole("button", { name: "Try again" }))
  expect(reset).toHaveBeenCalledOnce()
})
