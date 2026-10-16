import { describe, expect, it } from "vitest"

import { initialPlanSelection, readPlanOffer } from "./plan-preselection"

describe("plan preselection", () => {
  it.each([
    [undefined, "pro", "annual"],
    ["free", "free", "annual"],
    ["pro_monthly", "pro", "monthly"],
    ["pro_annual", "pro", "annual"],
    ["yc_2026", "free", "annual"],
  ] as const)("initializes %s", (offer, selection, cadence) => {
    expect(initialPlanSelection(offer)).toEqual({ selection, cadence })
  })

  it("isolates account preferences and ignores invalid values", () => {
    expect(
      readPlanOffer(JSON.stringify({ userId: "a", offer: "pro_annual" }), "a"),
    ).toBe("pro_annual")
    expect(
      readPlanOffer(JSON.stringify({ userId: "a", offer: "pro_annual" }), "b"),
    ).toBeUndefined()
    expect(
      readPlanOffer(JSON.stringify({ userId: "a", offer: "enterprise" }), "a"),
    ).toBeUndefined()
    expect(readPlanOffer("broken", "a")).toBeUndefined()
  })
})
