import { describe, expect, it } from "vitest"

import { parseSignupChoice } from "@/lib/api/signup-plan"

import {
  normalizeRequestedOffer,
  normalizeSignupRequestedOffer,
} from "./requested-offer"

describe("signup Pro alias", () => {
  it("canonicalizes user intent without accepting an alias as persisted billing authority", () => {
    expect(normalizeSignupRequestedOffer("pro")).toBe("pro_monthly")
    expect(normalizeSignupRequestedOffer("pro_monthly")).toBe("pro_monthly")
    expect(normalizeSignupRequestedOffer("unknown")).toBeUndefined()
    expect(normalizeRequestedOffer("pro")).toBeUndefined()
    expect(() =>
      parseSignupChoice({ state: "committed", offer_key: "pro" }),
    ).toThrow()
  })
})
