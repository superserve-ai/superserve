import "server-only"
import crypto from "node:crypto"

import { cellFor, DEFAULT_REGION } from "@/lib/cells"
import { createServerClient } from "@/lib/supabase/server"

type AccountOperation =
  | "bind"
  | "evidence"
  | "register"
  | "register-signup"
  | "signup-eligibility"
  | "create-team"
  | "prepare-team"
  | "recover-team"
  | "complete-team"
  | "discover-team-creations"

interface CreationLocator {
  readonly userId: string
  readonly operationId: string
  readonly region: string
}

export interface PromotionTeamPreparation extends CreationLocator {
  readonly name: string
  readonly authorityUnavailable: boolean
}

export interface PreparedPromotionTeam extends PromotionTeamPreparation {
  readonly attemptId: string
  readonly teamId: string
  readonly createdAt: string
  readonly state: "prepared" | "completed" | "deleted"
  readonly outcome: PromotionTeamCreationResult["outcome"] | null
  readonly reason: string | null
}

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
  | "creation_missing"
  | "creation_conflict"
  | "team_name_conflict"

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
  recovery?: Record<string, string | boolean>,
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
        ...(operation === "bind" || operation === "register-signup"
          ? { attempt_id: attemptId }
          : {}),
        ...(operation === "register-signup"
          ? { home_region: DEFAULT_REGION }
          : {}),
        ...(operation === "create-team" && creation
          ? {
              attempt_id: creation.attemptId,
              team_id: creation.teamId,
              home_region: creation.region,
              authority_unavailable: creation.authorityUnavailable,
            }
          : {}),
        ...recovery,
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
    recovery?: Record<string, string | boolean>
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
                  account.recovery,
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
      if (response.status === 404 && code === "creation_missing")
        throw new PromotionEvidenceError("creation_missing", response.status)
      if (
        response.status === 409 &&
        code === "creation_conflict" &&
        isRecord(errorBody) &&
        errorBody.message === "team name already exists"
      )
        throw new PromotionEvidenceError("team_name_conflict", response.status)
      if (response.status === 409 && code === "creation_conflict")
        throw new PromotionEvidenceError("creation_conflict", response.status)
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

/** Only the original trusted signup caller may publish before confirmation. */
export async function registerPromotionSignupAccount(
  userId: string,
  attemptId: string,
): Promise<"owner" | "owner_conflict"> {
  const result = await post(
    DEFAULT_REGION,
    "/internal/promotion/account/register-signup",
    "account",
    { user_id: userId, attempt_id: attemptId, home_region: DEFAULT_REGION },
    { userId, operation: "register-signup", attemptId },
  )
  if (result.outcome !== "owner" && result.outcome !== "owner_conflict")
    throw new PromotionEvidenceError("authority_unavailable")
  return result.outcome
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

function validCreationId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      value,
    ) &&
    value !== "00000000-0000-0000-0000-000000000000"
  )
}

function validateCreationRegion(region: string): void {
  if (region !== "use" && region !== "usw")
    throw new PromotionEvidenceError("invalid_evidence")
}

function validateCreationLocator(locator: CreationLocator): void {
  validateCreationRegion(locator.region)
  if (!validCreationId(locator.operationId))
    throw new PromotionEvidenceError("invalid_evidence")
}

function validatePreparation(input: PromotionTeamPreparation): void {
  validateCreationLocator(input)
  if (
    typeof input.name !== "string" ||
    !input.name.trim() ||
    Buffer.byteLength(input.name, "utf8") > 256 ||
    typeof input.authorityUnavailable !== "boolean"
  )
    throw new PromotionEvidenceError("invalid_evidence")
}

function readPreparedTeam(
  value: unknown,
  expected: Pick<CreationLocator, "userId" | "region"> &
    Partial<Omit<PreparedPromotionTeam, "userId" | "region">>,
): PreparedPromotionTeam {
  if (
    !isRecord(value) ||
    value.user_id !== expected.userId ||
    value.home_region !== expected.region ||
    !validCreationId(value.operation_id) ||
    !validCreationId(value.attempt_id) ||
    !validCreationId(value.team_id) ||
    typeof value.name !== "string" ||
    !value.name.trim() ||
    Buffer.byteLength(value.name, "utf8") > 256 ||
    typeof value.authority_unavailable !== "boolean" ||
    typeof value.created_at !== "string" ||
    !Number.isFinite(Date.parse(value.created_at)) ||
    (value.state !== "prepared" &&
      value.state !== "completed" &&
      value.state !== "deleted") ||
    (value.state === "prepared"
      ? value.outcome !== null || value.reason !== null
      : (value.outcome !== "granted" &&
          value.outcome !== "already_claimed" &&
          value.outcome !== "promotion_ineligible") ||
        typeof value.reason !== "string")
  )
    throw new PromotionEvidenceError("authority_unavailable")
  const result: PreparedPromotionTeam = {
    userId: expected.userId,
    region: expected.region,
    operationId: value.operation_id,
    attemptId: value.attempt_id,
    teamId: value.team_id,
    name: value.name,
    authorityUnavailable: value.authority_unavailable,
    createdAt: value.created_at,
    state: value.state as PreparedPromotionTeam["state"],
    outcome: value.outcome as PreparedPromotionTeam["outcome"],
    reason: value.reason as string | null,
  }
  for (const field of [
    "operationId",
    "attemptId",
    "teamId",
    "name",
    "authorityUnavailable",
  ] as const) {
    if (expected[field] !== undefined && expected[field] !== result[field])
      throw new PromotionEvidenceError("authority_unavailable")
  }
  return result
}

/** Persist before dispatch. The locator must already be retained by the caller. */
export async function preparePromotionTeam(
  input: PromotionTeamPreparation,
): Promise<PreparedPromotionTeam> {
  const binding = { ...input }
  validatePreparation(binding)
  const userId = await verifiedAccountId(binding.userId)
  const fields = {
    operation_id: binding.operationId,
    name: binding.name,
    home_region: binding.region,
    authority_unavailable: binding.authorityUnavailable,
  }
  const result = await post(
    binding.region,
    "/internal/promotion/account/prepare-team",
    "account",
    { user_id: userId, ...fields },
    { userId, operation: "prepare-team", recovery: fields },
  )
  return readPreparedTeam(result, binding)
}

/** Recover before republication: the stored decision is authoritative on retry. */
export async function recoverPromotionTeam(
  input: CreationLocator,
): Promise<PreparedPromotionTeam | null> {
  const binding = { ...input }
  validateCreationLocator(binding)
  const userId = await verifiedAccountId(binding.userId)
  const fields = {
    operation_id: binding.operationId,
    home_region: binding.region,
  }
  try {
    return readPreparedTeam(
      await post(
        binding.region,
        "/internal/promotion/account/recover-team",
        "account",
        { user_id: userId, ...fields },
        { userId, operation: "recover-team", recovery: fields },
      ),
      binding,
    )
  } catch (error) {
    // An old cell's 404 or a failed read is not proof that preparation is absent.
    if (
      error instanceof PromotionEvidenceError &&
      error.code === "creation_missing"
    )
      return null
    throw error
  }
}

/** Dispatch the recovered tuple unchanged; deleted results never recreate teams. */
export async function completePromotionTeam(
  input: PreparedPromotionTeam,
): Promise<PreparedPromotionTeam> {
  const binding = { ...input }
  validatePreparation(binding)
  if (!validCreationId(binding.attemptId) || !validCreationId(binding.teamId))
    throw new PromotionEvidenceError("invalid_evidence")
  const userId = await verifiedAccountId(binding.userId)
  const fields = {
    operation_id: binding.operationId,
    attempt_id: binding.attemptId,
    team_id: binding.teamId,
    name: binding.name,
    home_region: binding.region,
    authority_unavailable: binding.authorityUnavailable,
  }
  const result = readPreparedTeam(
    await post(
      binding.region,
      "/internal/promotion/account/complete-team",
      "account",
      { user_id: userId, ...fields },
      { userId, operation: "complete-team", recovery: fields },
    ),
    binding,
  )
  if (result.state === "prepared")
    throw new PromotionEvidenceError("authority_unavailable")
  return result
}

/** Discovery never selects or dispatches an operation, even with one candidate. */
export async function discoverPromotionTeams(input: {
  userId: string
  region: string
  after?: string
}): Promise<{
  state: "selection_required"
  operations: PreparedPromotionTeam[]
  nextCursor: string | null
}> {
  const binding = { ...input }
  validateCreationRegion(binding.region)
  if (binding.after !== undefined && !validCreationId(binding.after))
    throw new PromotionEvidenceError("invalid_evidence")
  const userId = await verifiedAccountId(binding.userId)
  const fields = {
    home_region: binding.region,
    ...(binding.after !== undefined ? { after: binding.after } : {}),
  }
  const result = await post(
    binding.region,
    "/internal/promotion/account/discover-team-creations",
    "account",
    { user_id: userId, ...fields },
    { userId, operation: "discover-team-creations", recovery: fields },
  )
  if (
    result.state !== "selection_required" ||
    !Array.isArray(result.operations) ||
    result.operations.length > 50 ||
    (result.next_cursor !== null && !validCreationId(result.next_cursor))
  )
    throw new PromotionEvidenceError("authority_unavailable")
  return {
    state: "selection_required",
    operations: result.operations.map((row) => readPreparedTeam(row, binding)),
    nextCursor: result.next_cursor,
  }
}
