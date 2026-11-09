import { describe, expect, it } from "vitest"

import {
  availableGranularities,
  defaultGranularity,
  isGranularityAvailable,
} from "./page-client"

describe("usage chart aggregation thresholds", () => {
  it.each([
    [7, "hourly"],
    [14, "daily"],
    [60, "daily"],
    [90, "daily"],
    [365, "weekly"],
    [366, "monthly"],
  ] as const)("defaults %s-day ranges to %s", (days, expected) => {
    expect(defaultGranularity(days)).toBe(expected)
  })

  it.each([
    [7, ["hourly", "daily"]],
    [14, ["daily", "weekly"]],
    [60, ["daily", "weekly", "monthly"]],
    [90, ["daily", "weekly", "monthly"]],
    [365, ["weekly", "monthly"]],
  ] as const)("exposes only valid options at %s days", (days, expected) => {
    expect(availableGranularities(days)).toEqual(expected)
  })

  it("preserves a valid selection and falls back when it becomes invalid", () => {
    expect(isGranularityAvailable(30, "daily")).toBe(true)
    expect(isGranularityAvailable(30, "hourly")).toBe(false)
    expect(defaultGranularity(30)).toBe("daily")
    expect(isGranularityAvailable(120, "daily")).toBe(false)
    expect(defaultGranularity(120)).toBe("weekly")
  })
})
