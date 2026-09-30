import { describe, expect, it } from "vitest"

import { formatSignupEligibility } from "./signup-eligibility"

describe("formatSignupEligibility", () => {
  it.each([
    {
      outcome: { kind: "eligible" },
      expected: {
        emoji: "✅",
        text: "Signup Fingerprint eligible for first account in East",
      },
    },
    {
      outcome: { kind: "enforced_other_owner" },
      expected: {
        emoji: "💸",
        text: "Signup Fingerprint already registered to another account in East",
      },
    },
    {
      outcome: { kind: "enforced_missing_evidence" },
      expected: {
        emoji: "💸",
        text: "Signup Fingerprint could not be verified",
      },
    },
  ])("renders the explicit $outcome.kind outcome", ({ outcome, expected }) => {
    expect(formatSignupEligibility(outcome)).toEqual(expected)
  })

  it("keeps another-owner and missing-evidence denial wording distinct", () => {
    const otherOwner = formatSignupEligibility({
      kind: "enforced_other_owner",
    })
    const missingEvidence = formatSignupEligibility({
      kind: "enforced_missing_evidence",
    })

    expect(otherOwner.emoji).toBe("💸")
    expect(missingEvidence.emoji).toBe("💸")
    expect(otherOwner.text).not.toBe(missingEvidence.text)
  })

  it.each([
    undefined,
    null,
    { kind: "unavailable" },
    { kind: "unknown" },
    { kind: "eligible", reason: "raw provider response" },
  ])(
    "uses an unemoji'd fallback for unavailable or unknown input: %o",
    (outcome) => {
      expect(formatSignupEligibility(outcome)).toEqual({
        text: "Signup eligibility unavailable",
      })
    },
  )

  it("uses allowlisted blocked reasons and a safe fallback", () => {
    expect(
      formatSignupEligibility({ kind: "blocked", reason: "known_abuse" }),
    ).toEqual({
      emoji: "❌",
      text: "Signup blocked by abuse policy",
    })
    expect(
      formatSignupEligibility({ kind: "blocked", reason: "blocked_email" }),
    ).toEqual({
      emoji: "❌",
      text: "Signup blocked by configured signup restriction",
    })
    expect(
      formatSignupEligibility({
        kind: "blocked",
        reason: "raw provider reason with account id",
      }),
    ).toEqual({
      emoji: "❌",
      text: "Signup blocked by signup safety policy",
    })
  })

  it("never claims that a credit was granted", () => {
    const outputs = [
      formatSignupEligibility({ kind: "eligible" }),
      formatSignupEligibility({ kind: "enforced_other_owner" }),
      formatSignupEligibility({ kind: "enforced_missing_evidence" }),
      formatSignupEligibility({ kind: "blocked", reason: "known_abuse" }),
      formatSignupEligibility({ kind: "unavailable" }),
    ]

    expect(outputs.every(({ text }) => !/grant|credit|\$5/i.test(text))).toBe(
      true,
    )
  })
})
