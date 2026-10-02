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
    {
      outcome: { kind: "enforced_device_redeemed" },
      expected: {
        emoji: "💸",
        text: "Signup Fingerprint is not eligible under the East device policy",
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
      formatSignupEligibility({ kind: "enforced_device_redeemed" }),
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
        ownership: "owner",
        deviceDecision: "eligible",
        eligibility: "unknown",
        reason: "verified_identity_missing",
      },
      { kind: "eligible" },
    ],
    [
      {
        ownership: "owner",
        deviceDecision: "eligible",
        eligibility: "unknown",
        reason: "historical_identity_unresolved",
      },
      { kind: "eligible" },
    ],
    [
      {
        ownership: "another_owner",
        deviceDecision: "owner_conflict",
        eligibility: "ineligible",
        reason: "owner_conflict",
      },
      { kind: "enforced_other_owner" },
    ],
    [
      {
        ownership: "evidence_missing",
        deviceDecision: "evidence_missing",
        eligibility: "ineligible",
        reason: "evidence_missing",
      },
      { kind: "enforced_missing_evidence" },
    ],
    [
      {
        ownership: "owner",
        deviceDecision: "device_already_redeemed",
        eligibility: "ineligible",
        reason: "device_already_redeemed",
      },
      { kind: "enforced_device_redeemed" },
    ],
  ])("maps the exact policy-aware combination", (snapshot, expected) => {
    expect(normalizeSignupEligibilitySnapshot(snapshot)).toEqual(expected)
  })

  it.each([
    {
      ownership: "another_owner",
      deviceDecision: "eligible",
      eligibility: "unknown",
      reason: "team_checks_pending",
    },
    {
      ownership: "evidence_missing",
      deviceDecision: "eligible",
      eligibility: "unknown",
      reason: "team_checks_pending",
    },
    {
      ownership: "owner",
      deviceDecision: "eligible",
      eligibility: "ineligible",
      reason: "user_already_claimed",
    },
    {
      ownership: "owner",
      deviceDecision: "eligible",
      eligibility: "ineligible",
      reason: "identity_already_claimed",
    },
  ])(
    "keeps bypassed or non-device ineligibility unavailable through formatting",
    (snapshot) => {
      const outcome = normalizeSignupEligibilitySnapshot(snapshot)
      expect(outcome).toEqual({
        kind: "unavailable",
      })
      expect(formatSignupEligibility(outcome)).toEqual({
        text: "Signup eligibility unavailable",
      })
    },
  )

  it("does not infer a definitive annotation from a valid non-device failure", () => {
    const outcome = normalizeSignupEligibilitySnapshot({
      ownership: "owner",
      deviceDecision: "eligible",
      eligibility: "ineligible",
      reason: "user_already_claimed",
    })

    expect(outcome).toEqual({
      kind: "unavailable",
    })
    expect(formatSignupEligibility(outcome).emoji).toBeUndefined()
  })

  it.each([
    {
      ownership: "owner",
      deviceDecision: "eligible",
      eligibility: "unknown",
      reason: "unexpected_reason",
    },
    {
      ownership: "owner",
      deviceDecision: "device_already_redeemed",
      eligibility: "ineligible",
      reason: "owner_conflict",
    },
    {
      ownership: "another_owner",
      deviceDecision: "owner_conflict",
      eligibility: "ineligible",
      reason: 42,
    },
  ])("does not trust malformed snapshots: %o", (snapshot) => {
    expect(normalizeSignupEligibilitySnapshot(snapshot)).toEqual({
      kind: "unavailable",
    })
  })
})
