import { describe, expect, it } from "vitest"

import type { BillingSummaryResponse } from "@/lib/api/billing"

import {
  advanceRunway,
  burnRate,
  formatMinutesLeft,
  nextMinutesLabelChange,
  runwayDecision,
  trialReading,
} from "./trial-runway"

const T0 = Date.parse("2026-11-18T08:00:00Z")

function summary(
  overrides: Partial<BillingSummaryResponse> = {},
): BillingSummaryResponse {
  return {
    permissions: { can_view: true, can_manage: true },
    trial: { state: "active", eligible: true, remaining_usd: 0.03 },
    calculated_at: new Date(T0).toISOString(),
    ...overrides,
  } as BillingSummaryResponse
}

describe("trialReading", () => {
  it("reads a live sign-up trial", () => {
    expect(trialReading(summary(), "trial")).toEqual({
      at: T0,
      remainingUsd: 0.03,
    })
  })

  it.each([
    ["no trial entry", summary(), null],
    ["an ended trial entry", summary(), "trial_ended"],
    ["an activating plan", summary(), "activating"],
    ["a trial block", summary({ trial_block: "trial_exhausted" }), "trial"],
    [
      "an exhausted trial",
      summary({ trial: { state: "exhausted", remaining_usd: 0 } }),
      "trial",
    ],
    [
      "an ineligible trial",
      summary({
        trial: { state: "active", eligible: false, remaining_usd: 0.03 },
      }),
      "trial",
    ],
    [
      "no balance left",
      summary({ trial: { state: "active", remaining_usd: 0 } }),
      "trial",
    ],
    [
      "an unknown balance",
      summary({ trial: { state: "active", remaining_usd: null } }),
      "trial",
    ],
    ["no calculation time", summary({ calculated_at: "" }), "trial"],
    [
      "no view permission",
      summary({ permissions: { can_view: false, can_manage: false } }),
      "trial",
    ],
  ] as const)("ignores %s", (_, value, entry) => {
    expect(trialReading(value, entry)).toBeNull()
  })
})

describe("burnRate", () => {
  it("is the USD per minute between two readings", () => {
    expect(
      burnRate(
        { at: T0, remainingUsd: 0.03 },
        { at: T0 + 60_000, remainingUsd: 0.028 },
      ),
    ).toBeCloseTo(0.002)
  })

  it.each([
    ["too close", 4_000, 0.0299],
    ["too far apart", 5 * 60_000 + 1, 0.02],
    ["a balance that went up", 60_000, 0.04],
  ])("is unknown for readings %s", (_, elapsed, remaining) => {
    expect(
      burnRate(
        { at: T0, remainingUsd: 0.03 },
        { at: T0 + elapsed, remainingUsd: remaining },
      ),
    ).toBeNull()
  })

  it("is zero when nothing used credit", () => {
    expect(
      burnRate(
        { at: T0, remainingUsd: 0.03 },
        { at: T0 + 60_000, remainingUsd: 0.03 },
      ),
    ).toBe(0)
  })
})

describe("advanceRunway", () => {
  const first = { at: T0, remainingUsd: 0.03 }
  const second = { at: T0 + 60_000, remainingUsd: 0.028 }

  it("needs two readings of the same team for a rate", () => {
    const track = advanceRunway(null, "use:a", first)
    expect(track).toEqual({
      team: "use:a",
      baseline: first,
      latestAt: T0,
      latestUsd: 0.03,
      burnUsdPerMinute: null,
    })
    const next = advanceRunway(track, "use:a", second)
    expect(next?.burnUsdPerMinute).toBeCloseTo(0.002)
  })

  it("keeps the same track for the same or an older reading", () => {
    const track = advanceRunway(
      advanceRunway(null, "use:a", first),
      "use:a",
      second,
    )
    expect(advanceRunway(track, "use:a", { ...second })).toBe(track)
    expect(advanceRunway(track, "use:a", first)).toBe(track)
    expect(advanceRunway(track, "use:a", null)).toBe(track)
  })

  it("keeps the estimate when a refresh comes too soon", () => {
    const track = advanceRunway(
      advanceRunway(null, "use:a", first),
      "use:a",
      second,
    )
    const soon = { at: T0 + 62_000, remainingUsd: 0.0279 }
    expect(advanceRunway(track, "use:a", soon)).toEqual({
      team: "use:a",
      baseline: second,
      latestAt: T0 + 62_000,
      latestUsd: 0.0279,
      burnUsdPerMinute: track?.burnUsdPerMinute,
    })
  })

  it("measures again after the balance goes up", () => {
    const track = advanceRunway(
      advanceRunway(null, "use:a", first),
      "use:a",
      second,
    )
    const grant = { at: T0 + 62_000, remainingUsd: 0.05 }
    expect(advanceRunway(track, "use:a", grant)).toEqual({
      team: "use:a",
      baseline: grant,
      latestAt: T0 + 62_000,
      latestUsd: 0.05,
      burnUsdPerMinute: null,
    })
  })

  it("measures again when a balance goes up after a quick refresh", () => {
    const track = advanceRunway(
      advanceRunway(null, "use:a", first),
      "use:a",
      second,
    )
    const soon = advanceRunway(track, "use:a", {
      at: T0 + 62_000,
      remainingUsd: 0.026,
    })
    // Still below the baseline, but above the reading before it.
    const grant = { at: T0 + 64_000, remainingUsd: 0.027 }
    expect(advanceRunway(soon, "use:a", grant)?.burnUsdPerMinute).toBeNull()
  })

  it("starts again for another team", () => {
    const track = advanceRunway(null, "use:a", first)
    expect(advanceRunway(track, "usw:b", second)).toEqual({
      team: "usw:b",
      baseline: second,
      latestAt: T0 + 60_000,
      latestUsd: 0.028,
      burnUsdPerMinute: null,
    })
    expect(advanceRunway(track, "usw:b", null)).toBeNull()
    expect(advanceRunway(track, null, second)).toBeNull()
  })
})

describe("runwayDecision", () => {
  it("warns at 10 minutes or less at the burn rate", () => {
    expect(runwayDecision(0.02, 0.002)).toEqual({
      show: true,
      mode: "burn_rate",
      minutesLeft: 10,
    })
    expect(runwayDecision(0.01, 0.002)).toMatchObject({
      show: true,
      minutesLeft: 5,
    })
  })

  it("does not warn above 10 minutes at the burn rate", () => {
    expect(runwayDecision(0.0201, 0.002)).toMatchObject({
      show: false,
      mode: "burn_rate",
    })
    // A low balance that lasts long enough at a slow burn.
    expect(runwayDecision(0.01, 0.0005)).toMatchObject({ show: false })
  })

  it("does not warn while nothing uses credit", () => {
    expect(runwayDecision(0.001, 0)).toEqual({
      show: false,
      mode: "burn_rate",
      minutesLeft: null,
    })
  })

  it("uses the fixed $0.02 threshold without a burn rate", () => {
    expect(runwayDecision(0.02, null)).toEqual({
      show: true,
      mode: "fixed",
      minutesLeft: null,
    })
    expect(runwayDecision(0.021, null)).toMatchObject({
      show: false,
      mode: "fixed",
    })
  })

  it("does not warn without credit left", () => {
    expect(runwayDecision(0, 0.002).show).toBe(false)
    expect(runwayDecision(Number.NaN, null).show).toBe(false)
  })
})

describe("formatMinutesLeft", () => {
  it.each([
    [0.4, "less than a minute"],
    [1.2, "about 1 minute"],
    [6.6, "about 7 minutes"],
  ])("formats %s", (minutes, text) => {
    expect(formatMinutesLeft(minutes)).toBe(text)
  })
})

describe("nextMinutesLabelChange", () => {
  it.each([
    [4.3, 3.5],
    [4.5, 4.5],
    [1.2, 1],
    [1, 1],
    [0.4, null],
  ])("for %s minutes left is %s", (minutes, next) => {
    expect(nextMinutesLabelChange(minutes)).toBe(next)
    // Just below the change, the text differs from the text now.
    if (next !== null) {
      expect(formatMinutesLeft(next - 0.001)).not.toBe(
        formatMinutesLeft(minutes),
      )
    }
  })
})
