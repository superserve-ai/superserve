import { act, fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { CommandPalette } from "./command-palette"

const push = vi.fn()

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}))

function openPalette() {
  render(<CommandPalette />)
  act(() => {
    fireEvent.keyDown(window, { key: "k", metaKey: true })
  })
}

function search(text: string) {
  fireEvent.change(screen.getByPlaceholderText("Type a command or search..."), {
    target: { value: text },
  })
}

describe("CommandPalette", () => {
  it("lists Team after Settings and opens /team", () => {
    openPalette()

    const labels = screen
      .getAllByRole("option")
      .map((option) => option.textContent)
    expect(labels.indexOf("Team")).toBe(labels.indexOf("Settings") + 1)

    fireEvent.click(screen.getByRole("option", { name: "Team" }))
    expect(push).toHaveBeenCalledWith("/team")
  })

  it.each(["members", "invite", "roles", "people"])(
    "finds Team by the word %s",
    (word) => {
      openPalette()
      search(word)

      expect(screen.getByRole("option", { name: "Team" })).toBeInTheDocument()
      expect(screen.queryByText("No results found.")).not.toBeInTheDocument()
    },
  )
})
