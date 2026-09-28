import "server-only"
import crypto from "node:crypto"

import { cellFor, DEFAULT_REGION } from "@/lib/cells"
import { createServerClient } from "@/lib/supabase/server"

type AccountOperation =
  | "bind"
  | "evidence"
  | "register"
  | "signup-eligibility"
  | "create-team"

/** Server-owned binding, retained by the caller before the first creation call. */
export interface PromotionTeamCreationAttempt {
  readonly userId: string
  readonly attemptId: string
  readonly teamId: string
  readonly name: string
  readonly region: string
  readonly authorityUnavailable: boolean
}

export interface PromotionTeamCreationResult {
  teamId: string
  outcome: "granted" | "already_claimed" | "promotion_ineligible"
  reason: string
}

export interface PromotionSignupEligibility {
  ownership: "owner" | "another_owner" | "evidence_missing"
  deviceDecision: string
  eligibility: "unknown" | "ineligible"
  reason: string
}

type PromotionEvidenceErrorCode =
  | "forbidden"
  | "evidence_missing"
  | "evidence_conflict"
  | "invalid_evidence"
  | "authority_unavailable"

export class PromotionEvidenceError extends Error {
  constructor(
    readonly code: PromotionEvidenceErrorCode,
    readonly status?: number,
  ) {
    super(code)
    this.name = "PromotionEvidenceError"
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0)
    throw new PromotionEvidenceError("authority_unavailable")
  return value
}

function producerToken(region: string, kind: "capture" | "account"): string {
  const capture = process.env.PROMOTION_CAPTURE_TOKEN
  const eastAccount = process.env.PROMOTION_ACCOUNT_TOKEN
  const account =
    region === "usw" ? process.env.PROMOTION_ACCOUNT_TOKEN_USWEST : eastAccount
  if (
    !capture ||
    !eastAccount ||
    !account ||
    capture === eastAccount ||
    capture === account ||
    (region === "usw" && account === eastAccount) ||
    capture === process.env.INTERNAL_API_TOKEN ||
    account === process.env.INTERNAL_API_TOKEN ||
    capture === process.env.SANDBOX_INTERNAL_API_TOKEN ||
    account === process.env.SANDBOX_INTERNAL_API_TOKEN
  )
    throw new PromotionEvidenceError("authority_unavailable")
  return kind === "capture" ? capture : account
}

async function verifiedAccountId(expectedUserId?: string): Promise<string> {
  try {
    const supabase = await createServerClient()
    const { data, error } = await supabase.auth.getUser()
    if (
      error ||
      !data.user?.id ||
      (expectedUserId !== undefined && data.user.id !== expectedUserId)
    )
      throw new PromotionEvidenceError("forbidden", 403)
    return data.user.id
  } catch {
    throw new PromotionEvidenceError("forbidden", 403)
  }
}

// Only the server-owned signup flow may supply bind provenance. Account reuse
// reaches this signer only after the current Auth credential has been verified.
function accountAssertion(
  userId: string,
  operation: AccountOperation,
  attemptId?: string,
  creation?: PromotionTeamCreationAttempt,
): string {
  try {
    const key = crypto.createPrivateKey(
      requiredString(process.env.PROMOTION_ACCOUNT_PRIVATE_KEY),
    )
    if (key.asymmetricKeyType !== "ed25519")
      throw new PromotionEvidenceError("authority_unavailable")
    const now = Math.floor(Date.now() / 1000)
    const header = Buffer.from(
      JSON.stringify({ alg: "EdDSA", typ: "JWT" }),
    ).toString("base64url")
    const payload = Buffer.from(
      JSON.stringify({
        iss: "promotion-auth-adapter",
        aud: "promotion-account",
        sub: userId,
        iat: now,
        exp: now + 300,
        operation,
        ...(operation === "bind" ? { attempt_id: attemptId } : {}),
        ...(operation === "create-team" && creation
          ? {
              attempt_id: creation.attemptId,
              team_id: creation.teamId,
              home_region: creation.region,
              authority_unavailable: creation.authorityUnavailable,
            }
          : {}),
      }),
    ).toString("base64url")
    const input = `${header}.${payload}`
    return `${input}.${crypto.sign(null, Buffer.from(input), key).toString("base64url")}`
  } catch {
    throw new PromotionEvidenceError("authority_unavailable")
  }
}

async function post(
  region: string,
  path: string,
  kind: "capture" | "account",
  body?: Record<string, string | boolean>,
  account?: {
    userId: string
    operation: AccountOperation
    attemptId?: string
    creation?: PromotionTeamCreationAttempt
  },
): Promise<Record<string, unknown>> {
  const token = producerToken(region, kind)
  try {
    const response = await fetch(
      `${cellFor(region).apiBaseUrl.replace(/\/$/, "")}${path}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...(account
            ? {
                "X-Actor-User-Id": account.userId,
                "X-Promotion-Account-Assertion": accountAssertion(
                  account.userId,
                  account.operation,
                  account.attemptId,
                  account.creation,
                ),
              }
            : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(4000),
        cache: "no-store",
      },
    )
    const payload: unknown = await response.json()
    if (!response.ok) {
      const errorBody = isRecord(payload) ? payload.error : undefined
      const code = isRecord(errorBody) ? errorBody.code : undefined
      if (response.status === 404 && code === "evidence_missing")
        throw new PromotionEvidenceError("evidence_missing", response.status)
      if (response.status === 409 && code === "evidence_conflict")
        throw new PromotionEvidenceError("evidence_conflict", response.status)
      if (response.status === 400 && code === "invalid_evidence")
        throw new PromotionEvidenceError("invalid_evidence", response.status)
      throw new PromotionEvidenceError("authority_unavailable", response.status)
    }
    if (!isRecord(payload))
      throw new PromotionEvidenceError("authority_unavailable", response.status)
    return payload
  } catch (error) {
    if (error instanceof PromotionEvidenceError) throw error
    throw new PromotionEvidenceError("authority_unavailable")
  }
}

/** Issue the signup challenge from the shared source, via the East control plane. */
export async function createPromotionSignupAttempt(): Promise<{
  attemptId: string
  challenge: string
}> {
  const result = await post(
    DEFAULT_REGION,
    "/internal/promotion/signup/attempts",
    "capture",
  )
  return {
    attemptId: requiredString(result.attempt_id),
    challenge: requiredString(result.challenge),
  }
}

/** Call only after the provider's server event attests the issued challenge. */
export async function verifyPromotionSignupAttempt(input: {
  attemptId: string
  challenge: string
  eventId: string
  fingerprint: string
  eventAt: string
}): Promise<"verified" | "replayed"> {
  const result = await post(
    DEFAULT_REGION,
    "/internal/promotion/signup/attempts/verify",
    "capture",
    {
      attempt_id: input.attemptId,
      challenge: input.challenge,
      event_id: input.eventId,
      fingerprint: input.fingerprint,
      event_at: input.eventAt,
    },
  )
  if (result.outcome !== "verified" && result.outcome !== "replayed")
    throw new PromotionEvidenceError("authority_unavailable")
  return result.outcome
}

/** The caller supplies the trusted Auth signup result, never a browser actor. */
export async function bindPromotionSignupAccount(
  userId: string,
  attemptId: string,
): Promise<"bound" | "replayed" | "first_evidence_retained"> {
  const result = await post(
    DEFAULT_REGION,
    "/internal/promotion/account/bind",
    "account",
    { user_id: userId, attempt_id: attemptId },
    { userId, operation: "bind", attemptId },
  )
  if (
    result.outcome !== "bound" &&
    result.outcome !== "replayed" &&
    result.outcome !== "first_evidence_retained"
  )
    throw new PromotionEvidenceError("authority_unavailable")
  return result.outcome
}

export interface OriginalPromotionSignupEvidence {
  attemptId: string
  eventId: string
  fingerprint: string
  eventAt: string
  boundAt: string
}

/** Retrieve only the current verified account, even if a caller supplies a target. */
export async function getPromotionSignupAccountEvidence(
  expectedUserId?: string,
): Promise<OriginalPromotionSignupEvidence> {
  const userId = await verifiedAccountId(expectedUserId)
  const result = await post(
    DEFAULT_REGION,
    "/internal/promotion/account/evidence",
    "account",
    { user_id: userId },
    { userId, operation: "evidence" },
  )
  return {
    attemptId: requiredString(result.attempt_id),
    eventId: requiredString(result.event_id),
    fingerprint: requiredString(result.fingerprint),
    eventAt: requiredString(result.event_at),
    boundAt: requiredString(result.bound_at),
  }
}

/** The selected region independently records ownership from shared evidence. */
export async function registerPromotionSignupDevice(
  region: string,
  expectedUserId?: string,
): Promise<"owner" | "owner_conflict"> {
  const userId = await verifiedAccountId(expectedUserId)
  const result = await post(
    region,
    "/internal/promotion/account/register",
    "account",
    { user_id: userId },
    { userId, operation: "register" },
  )
  if (result.outcome !== "owner" && result.outcome !== "owner_conflict")
    throw new PromotionEvidenceError("authority_unavailable")
  return result.outcome
}

/** A non-issuing East snapshot; it cannot prove that a team received credit. */
export async function getPromotionSignupEligibility(
  expectedUserId?: string,
): Promise<PromotionSignupEligibility> {
  const userId = await verifiedAccountId(expectedUserId)
  const result = await post(
    DEFAULT_REGION,
    "/internal/promotion/account/signup-eligibility",
    "account",
    { user_id: userId },
    { userId, operation: "signup-eligibility" },
  )
  if (
    (result.ownership !== "owner" &&
      result.ownership !== "another_owner" &&
      result.ownership !== "evidence_missing") ||
    (result.eligibility !== "unknown" && result.eligibility !== "ineligible")
  )
    throw new PromotionEvidenceError("authority_unavailable")
  return {
    ownership: result.ownership,
    deviceDecision: requiredString(result.device_decision),
    eligibility: result.eligibility,
    reason: requiredString(result.reason),
  }
}

/**
 * Submit only a persisted server-owned creation binding. The caller derives
 * authorityUnavailable from publication results, never browser input, and must
 * replay every field unchanged after uncertainty, including after recovery.
 * The backend retains the original outcome even if the team has been deleted.
 */
export async function createTeamWithPromotionAttempt(
  attempt: PromotionTeamCreationAttempt,
): Promise<PromotionTeamCreationResult> {
  // Snapshot before awaiting Auth, so mutation by a caller cannot split the
  // signed fields, request body, response check or selected regional endpoint.
  const binding = { ...attempt }
  const userId = await verifiedAccountId(binding.userId)
  if (
    typeof binding.authorityUnavailable !== "boolean" ||
    (binding.region !== "use" && binding.region !== "usw")
  )
    throw new PromotionEvidenceError("invalid_evidence")
  const result = await post(
    binding.region,
    "/internal/promotion/account/create-team",
    "account",
    {
      user_id: userId,
      attempt_id: binding.attemptId,
      team_id: binding.teamId,
      name: binding.name,
      home_region: binding.region,
      authority_unavailable: binding.authorityUnavailable,
    },
    { userId, operation: "create-team", creation: binding },
  )
  if (
    result.team_id !== binding.teamId ||
    (result.outcome !== "granted" &&
      result.outcome !== "already_claimed" &&
      result.outcome !== "promotion_ineligible") ||
    typeof result.reason !== "string"
  )
    throw new PromotionEvidenceError("authority_unavailable")
  return {
    teamId: binding.teamId,
    outcome: result.outcome,
    reason: result.reason,
  }
}
