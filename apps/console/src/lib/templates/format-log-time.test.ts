import { describe, expect, it } from "vitest"

import { formatLogTime } from "./format-log-time"

describe("formatLogTime", () => {
  it("renders an ISO timestamp as a local time of day", () => {
    expect(formatLogTime("2026-10-05T18:40:38.000Z")).toMatch(
      /^\d{2}:\d{2}:\d{2}$/,
    )
  })

  it("falls back to the time portion of an unparseable stamp", () => {
    expect(formatLogTime("2026-13-45T18:40:38Z")).toBe("18:40:38")
  })

  it("renders nothing for an event that carries no timestamp", () => {
    for (const missing of [undefined, ""]) {
      expect(formatLogTime(missing)).toBe("")
    }
  })
})
