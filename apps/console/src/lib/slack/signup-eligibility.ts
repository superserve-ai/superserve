/**
 * The small, local presentation contract used by the signup Slack message.
 *
 * This is intentionally not the SS-640 producer response. The producer must
 * translate its policy-aware result into one of these explicit outcomes before
 * handing it to the notification boundary.
 */
export type SignupEligibilityPresentationOutcome =
  | { kind: "eligible" }
  | { kind: "enforced_other_owner" }
  | { kind: "enforced_missing_evidence" }
  | { kind: "blocked"; reason?: SignupBlockedReason }
  | { kind: "unavailable" }

/** Reasons that SS-499 may safely expose in the notification. */
export type SignupBlockedReason =
  | "known_abuse"
  | "restricted_identity"
  | "policy_restriction"
  | "blocked_email"

export type SignupEligibilityAnnotation = {
  emoji?: "✅" | "💸" | "❌"
  text: string
}

/**
 * Convert the trusted SS-640 snapshot into the deliberately smaller local
 * presentation contract. Ownership alone is never enough: the backend's
 * policy-aware device decision and eligibility state must agree on an
 * enforced outcome before a definitive emoji is selected.
 */
export function normalizeSignupEligibilitySnapshot(
  snapshot: unknown,
): SignupEligibilityPresentationOutcome {
  try {
    if (!snapshot || typeof snapshot !== "object")
      return { kind: "unavailable" }
    const value = snapshot as Record<string, unknown>
    const expectedKeys = [
      "ownership",
      "deviceDecision",
      "eligibility",
      "reason",
    ] as const
    if (
      Object.keys(value).length !== expectedKeys.length ||
      expectedKeys.some(
        (key) => !Object.prototype.hasOwnProperty.call(value, key),
      ) ||
      Object.keys(value).some(
        (key) => !expectedKeys.some((expectedKey) => expectedKey === key),
      ) ||
      typeof value.reason !== "string" ||
      value.reason.length === 0
    )
      return { kind: "unavailable" }

    if (
      value.ownership === "owner" &&
      value.deviceDecision === "eligible" &&
      value.eligibility === "unknown"
    )
      return { kind: "eligible" }
    if (
      value.ownership === "another_owner" &&
      value.deviceDecision === "owner_conflict" &&
      value.eligibility === "ineligible"
    )
      return { kind: "enforced_other_owner" }
    if (
      value.ownership === "evidence_missing" &&
      value.deviceDecision === "evidence_missing" &&
      value.eligibility === "ineligible"
    )
      return { kind: "enforced_missing_evidence" }
  } catch {
    // Untrusted or hostile values must remain unavailable.
  }
  return { kind: "unavailable" }
}

const unavailableAnnotation = (): SignupEligibilityAnnotation => ({
  text: "Signup eligibility unavailable",
})

const BLOCKED_REASON_TEXT: Record<SignupBlockedReason, string> = {
  known_abuse: "Signup blocked by abuse policy",
  restricted_identity: "Signup blocked by identity safety policy",
  policy_restriction: "Signup blocked by signup safety policy",
  blocked_email: "Signup blocked by configured signup restriction",
}

function isKnownBlockedReason(value: unknown): value is SignupBlockedReason {
  return (
    value === "known_abuse" ||
    value === "restricted_identity" ||
    value === "policy_restriction" ||
    value === "blocked_email"
  )
}

function hasOnlyKeys(value: object, allowedKeys: readonly string[]): boolean {
  return (
    Object.prototype.hasOwnProperty.call(value, "kind") &&
    Object.keys(value).every((key) => allowedKeys.includes(key))
  )
}

/**
 * Render an explicit, safe signup eligibility outcome for Slack.
 *
 * Unknown, absent, or malformed values intentionally use the unavailable
 * fallback. In particular, raw provider reasons and other-account details are
 * never copied into a Slack payload.
 */
export function formatSignupEligibility(
  outcome: unknown,
): SignupEligibilityAnnotation {
  try {
    if (!outcome || typeof outcome !== "object") {
      return unavailableAnnotation()
    }

    const kind = (outcome as { kind?: unknown }).kind

    switch (kind) {
      case "eligible":
        if (!hasOnlyKeys(outcome, ["kind"])) {
          return unavailableAnnotation()
        }
        return {
          emoji: "✅",
          text: "Signup Fingerprint eligible for first account in East",
        }
      case "enforced_other_owner":
        if (!hasOnlyKeys(outcome, ["kind"])) {
          return unavailableAnnotation()
        }
        return {
          emoji: "💸",
          text: "Signup Fingerprint already registered to another account in East",
        }
      case "enforced_missing_evidence":
        if (!hasOnlyKeys(outcome, ["kind"])) {
          return unavailableAnnotation()
        }
        return {
          emoji: "💸",
          text: "Signup Fingerprint could not be verified",
        }
      case "blocked": {
        if (!hasOnlyKeys(outcome, ["kind", "reason"])) {
          return unavailableAnnotation()
        }
        const reason = (outcome as { reason?: unknown }).reason
        return {
          emoji: "❌",
          text: isKnownBlockedReason(reason)
            ? BLOCKED_REASON_TEXT[reason]
            : "Signup blocked by signup safety policy",
        }
      }
      case "unavailable":
      default:
        return unavailableAnnotation()
    }
  } catch {
    return unavailableAnnotation()
  }
}
