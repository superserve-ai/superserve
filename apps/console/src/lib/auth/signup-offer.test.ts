import { describe, expect, it } from "vitest"

import { parseSignupOffer } from "./signup-offer"

describe("parseSignupOffer", () => {
  it.each([
    [undefined, "free"],
    ["", "free"],
    ["free", "free"],
    ["starter", "starter"],
    ["starter_monthly", "starter"],
    ["pro_monthly", "pro_monthly"],
    ["pro_annual", "pro_monthly"],
    ["yc_2026", "pro_monthly"],
    ["something_new", "pro_monthly"],
    ["enterprise", "enterprise"],
  ])("maps %s to %s", (raw, offer) => {
    expect(parseSignupOffer(raw)).toBe(offer)
  })
})
