import { cellFor, DEFAULT_REGION } from "@/lib/cells"

type PromotionEvidenceErrorCode =
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

function producerToken(kind: "capture" | "account"): string {
  const capture = process.env.PROMOTION_CAPTURE_TOKEN
  const account = process.env.PROMOTION_ACCOUNT_TOKEN
  if (
    !capture ||
    !account ||
    capture === account ||
    capture === process.env.INTERNAL_API_TOKEN ||
    account === process.env.INTERNAL_API_TOKEN ||
    capture === process.env.SANDBOX_INTERNAL_API_TOKEN ||
    account === process.env.SANDBOX_INTERNAL_API_TOKEN
  )
    throw new PromotionEvidenceError("authority_unavailable")
  return kind === "capture" ? capture : account
}

async function post(
  region: string,
  path: string,
  kind: "capture" | "account",
  body?: Record<string, string>,
  actorUserId?: string,
): Promise<Record<string, unknown>> {
  const token = producerToken(kind)
  try {
    const response = await fetch(
      `${cellFor(region).apiBaseUrl.replace(/\/$/, "")}${path}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...(actorUserId ? { "X-Actor-User-Id": actorUserId } : {}),
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
    userId,
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

/** The caller must first establish that userId is the authenticated principal. */
export async function getPromotionSignupAccountEvidence(
  userId: string,
): Promise<OriginalPromotionSignupEvidence> {
  const result = await post(
    DEFAULT_REGION,
    "/internal/promotion/account/evidence",
    "account",
    { user_id: userId },
    userId,
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
  userId: string,
): Promise<"owner" | "owner_conflict"> {
  const result = await post(
    region,
    "/internal/promotion/account/register",
    "account",
    { user_id: userId },
    userId,
  )
  if (result.outcome !== "owner" && result.outcome !== "owner_conflict")
    throw new PromotionEvidenceError("authority_unavailable")
  return result.outcome
}
