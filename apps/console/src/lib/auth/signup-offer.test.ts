import { describe, expect, it } from "vitest"

import { isSelfServeSignupOffer, parseSignupOffer } from "./signup-offer"

describe("parseSignupOffer", () => {
  it.each([
    [undefined, "free"],
    ["", "free"],
    ["free", "free"],
    ["starter", "starter"],
    ["starter_monthly", "starter"],
    ["pro", "pro_monthly"],
    ["pro_monthly", "pro_monthly"],
    ["pro_annual", "pro_monthly"],
    ["yc_2026", "pro_monthly"],
    ["something_new", "pro_monthly"],
    ["enterprise", "enterprise"],
  ])("maps %s to %s", (raw, offer) => {
    expect(parseSignupOffer(raw)).toBe(offer)
  })
})

it.each([
  "free",
  "starter",
  "starter_monthly",
  "starter_legacy",
  "pro",
  "pro_monthly",
  "pro_annual",
])("recognizes explicit routing alias %s", (raw) => {
  expect(isSelfServeSignupOffer(raw)).toBe(true)
})
it.each([undefined, "", "unknown_offer", "enterprise", "yc_2026"])(
  "does not elevate parser fallback %s to self-serve routing",
  (raw) => {
    expect(isSelfServeSignupOffer(raw)).toBe(false)
  },
)
