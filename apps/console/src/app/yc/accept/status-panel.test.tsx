import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { journeyMessages, type JourneyState } from "@/lib/yc/journey-state"

import { StatusPanel } from "./status-panel"

describe("authoritative offer states", () => {
  it.each(Object.keys(journeyMessages) as JourneyState[])(
    "renders %s without granting premature access",
    (state) => {
      render(<StatusPanel state={state} readyAction={async () => {}} />)
      expect(screen.getByRole("heading")).toHaveTextContent(
        journeyMessages[state].title,
      )
      expect(
        screen.queryByRole("button", { name: "Open Console" }) !== null,
      ).toBe(state === "funding_ready")
      expect(
        screen.queryByRole("link", { name: "Choose a standard plan" }) !== null,
      ).toBe(state === "rejected")
    },
  )
  it("closes unknown future states", () => {
    render(<StatusPanel state={"future_ready" as JourneyState} />)
    expect(screen.getByRole("heading")).toHaveTextContent(
      "We could not check your offer",
    )
    expect(screen.queryByRole("link")).not.toBeInTheDocument()
  })
})
