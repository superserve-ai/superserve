import { describe, expect, it } from "vitest"

import { pricingVersionOf } from "./pricing-version"

describe("pricingVersionOf", () => {
  it("is v2 only when the catalog says so explicitly", () => {
    expect(pricingVersionOf({ pricing_version: "v2", plans: [] })).toBe("v2")
    for (const body of [
      { plans: [] },
      { pricing_version: "legacy" },
      { pricing_version: "V2" },
      { pricing_version: true },
      null,
      "v2",
      [],
    ]) {
      expect(pricingVersionOf(body)).toBe("legacy")
    }
  })
})
