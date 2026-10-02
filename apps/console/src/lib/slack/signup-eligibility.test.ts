import { describe, expect, it } from "vitest"

import {
  formatSignupEligibility,
  normalizeSignupEligibilitySnapshot,
} from "./signup-eligibility"

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
    Object.assign(Object.create({ kind: "eligible" }), {}),
  ])(
    "uses an unemoji'd fallback for unavailable or unknown input: %o",
    (outcome) => {
      expect(formatSignupEligibility(outcome)).toEqual({
        text: "Signup eligibility unavailable",
      })
    },
  )

  it.each([
    ["known_abuse", "Signup blocked by abuse policy"],
    ["restricted_identity", "Signup blocked by identity safety policy"],
    ["policy_restriction", "Signup blocked by signup safety policy"],
    ["blocked_email", "Signup blocked by configured signup restriction"],
  ])("uses the allowlisted blocked reason: %s", (reason, text) => {
    expect(formatSignupEligibility({ kind: "blocked", reason })).toEqual({
      emoji: "❌",
      text,
    })
  })

  it("uses a safe fallback for an unknown blocked reason", () => {
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

  it("falls back when inspecting an untrusted outcome throws", () => {
    const outcome = Object.defineProperty({}, "kind", {
      get() {
        throw new Error("unexpected provider access")
      },
    })

    expect(formatSignupEligibility(outcome)).toEqual({
      text: "Signup eligibility unavailable",
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

describe("normalizeSignupEligibilitySnapshot", () => {
  it.each([
    [
      {
        ownership: "owner",
        deviceDecision: "eligible",
        eligibility: "unknown",
        reason: "team_checks_pending",
      },
      { kind: "eligible" },
    ],
    [
      {
        ownership: "another_owner",
        deviceDecision: "owner_conflict",
        eligibility: "ineligible",
        reason: "already_registered",
      },
      { kind: "enforced_other_owner" },
    ],
    [
      {
        ownership: "evidence_missing",
        deviceDecision: "evidence_missing",
        eligibility: "ineligible",
        reason: "missing",
      },
      { kind: "enforced_missing_evidence" },
    ],
  ])("maps the exact policy-aware combination", (snapshot, expected) => {
    expect(normalizeSignupEligibilitySnapshot(snapshot)).toEqual(expected)
  })

  it.each([
    {
      ownership: "another_owner",
      deviceDecision: "owner_conflict",
      eligibility: "unknown",
    },
    {
      ownership: "evidence_missing",
      deviceDecision: "evidence_missing",
      eligibility: "unknown",
    },
    {
      ownership: "owner",
      deviceDecision: "eligible",
      eligibility: "ineligible",
    },
  ])(
    "does not infer a verdict when the policy combination is incomplete",
    (snapshot) => {
      expect(normalizeSignupEligibilitySnapshot(snapshot)).toEqual({
        kind: "unavailable",
      })
    },
  )
})
