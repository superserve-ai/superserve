import { describe, expect, it } from "vitest"

import {
  isSelfServeSignupOffer,
  parseSignupOffer,
  signInOfferDestination,
  SIGNUP_OFFER_DESTINATIONS,
} from "./signup-offer"

describe("parseSignupOffer", () => {
  it.each([
    [undefined, "free"],
    ["", "free"],
    ["free", "free"],
    ["developer", "developer"],
    ["starter", "developer"],
    ["starter_monthly", "developer"],
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
  "developer",
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

describe("signup destinations", () => {
  it.each(["free", "developer", "pro_monthly"] as const)(
    "starts a new %s signup on Free in the console",
    (offer) => {
      expect(SIGNUP_OFFER_DESTINATIONS[offer]).toBe("/sandboxes")
    },
  )

  it.each([
    ["pro_monthly", "/billing/pro/"],
    ["developer", "/sandboxes"],
    ["enterprise", "/sandboxes"],
  ])("signs an existing account in from a %s link to %s", (raw, path) => {
    expect(signInOfferDestination(raw)).toBe(path)
  })
})
