import "server-only"
import crypto from "node:crypto"

import type { User } from "@supabase/supabase-js"

import { mintTeamApiKey } from "@/lib/api/api-key-mint"
import {
  membershipExistsInCell,
  type TeamMembership,
} from "@/lib/api/team-directory"
import {
  assertSignupReviewCleared,
  SignupReviewPendingError,
} from "@/lib/auth/signup-review"
import { cellFor, DEFAULT_REGION } from "@/lib/cells"
import { createAdminClient } from "@/lib/supabase/admin"

// Device authorization grant (RFC 8628) for `superserve login`. Rows live in
// the default cell; the key is minted in the approving team's cell on the
// CLI's first poll after approval, so the raw key is never stored anywhere.

export const DEVICE_CODE_TTL_SECONDS = 600
export const DEVICE_POLL_INTERVAL_SECONDS = 5
const MAX_CODES_PER_REQUESTER = 10
const MAX_CLIENT_NAME_LENGTH = 64
// A team this young is a fresh signup whose trial credit a background worker
// may still be recording; the CLI waits out a brief 402 instead of failing.
const NEW_ACCOUNT_WINDOW_MS = 15 * 60_000
// No vowels, so a code never spells a word; no 0/O or 1/I lookalikes.
const USER_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ"

export type DevicePollError =
  | "authorization_pending"
  | "slow_down"
  | "expired_token"
  | "access_denied"
  | "invalid_grant"

export class DeviceLoginError extends Error {
  constructor(
    readonly code:
      | "rate_limited"
      | "invalid_code"
      | "unavailable"
      | DevicePollError,
    message: string,
  ) {
    super(message)
    this.name = "DeviceLoginError"
  }
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex")
}

function generateUserCode(): string {
  let code = ""
  for (let i = 0; i < 8; i++) {
    code += USER_CODE_ALPHABET[crypto.randomInt(USER_CODE_ALPHABET.length)]
  }
  return `${code.slice(0, 4)}-${code.slice(4)}`
}

/** Accepts what people type: any case, with or without the dash or spaces. */
export function normalizeUserCode(input: string | null | undefined) {
  const letters = (input ?? "").toUpperCase().replace(/[^A-Z]/g, "")
  if (letters.length !== 8) return null
  if ([...letters].some((ch) => !USER_CODE_ALPHABET.includes(ch))) return null
  return `${letters.slice(0, 4)}-${letters.slice(4)}`
}

export function sanitizeClientName(input: unknown): string {
  const name =
    typeof input === "string"
      ? input
          .replace(/[^\w.@ -]/g, "")
          .trim()
          .slice(0, MAX_CLIENT_NAME_LENGTH)
      : ""
  return name || "unknown device"
}

function deviceTable() {
  return cellFor(DEFAULT_REGION).createAdminClient().from("device_code")
}

export async function createDeviceCode(input: {
  clientName: string
  requester: string
}) {
  const deviceCode = crypto.randomBytes(32).toString("base64url")
  for (let attempt = 0; attempt < 3; attempt++) {
    const userCode = generateUserCode()
    // The count and insert share a per-requester lock, so a burst can't
    // overshoot the limit.
    const { data: started, error } = await cellFor(DEFAULT_REGION)
      .createAdminClient()
      .rpc("start_device_code", {
        p_device_code: sha256(deviceCode),
        p_user_code: userCode,
        p_client_name: input.clientName,
        p_requester_hash: sha256(`device-login:${input.requester}`),
        p_expires_at: new Date(
          Date.now() + DEVICE_CODE_TTL_SECONDS * 1000,
        ).toISOString(),
        p_max_per_window: MAX_CODES_PER_REQUESTER,
        p_window: `${DEVICE_CODE_TTL_SECONDS} seconds`,
      })
    if (error?.code === "23505") continue
    if (error) break
    if (!started)
      throw new DeviceLoginError(
        "rate_limited",
        "Too many login attempts. Try again in a few minutes.",
      )
    return { deviceCode, userCode }
  }
  throw new DeviceLoginError("unavailable", "Login is unavailable.")
}

/** The pending request a user code points at, or null when it can't be approved. */
export async function findPendingDeviceCode(userCode: string) {
  const { data, error } = await deviceTable()
    .select("client_name")
    .eq("user_code", userCode)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .maybeSingle()
  if (error) throw new DeviceLoginError("unavailable", "Login is unavailable.")
  return data ? { clientName: (data.client_name as string) ?? "" } : null
}

export async function approveDeviceCode(
  userCode: string,
  user: User,
  team: TeamMembership,
) {
  const { data, error } = await deviceTable()
    .update({
      status: "approved",
      user_id: user.id,
      team_id: team.teamId,
      team_region: team.region,
      approved_at: new Date().toISOString(),
      // A fresh window to redeem: --no-wait agents pick the key up on a later run.
      expires_at: new Date(
        Date.now() + DEVICE_CODE_TTL_SECONDS * 1000,
      ).toISOString(),
    })
    .eq("user_code", userCode)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .select("id")
  if (error) throw new DeviceLoginError("unavailable", "Login is unavailable.")
  if (!data?.length)
    throw new DeviceLoginError(
      "invalid_code",
      "This code has expired or was already used. Run superserve login again.",
    )
}

export async function denyDeviceCode(userCode: string) {
  const { data, error } = await deviceTable()
    .update({ status: "denied" })
    .eq("user_code", userCode)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .select("id")
  if (error) throw new DeviceLoginError("unavailable", "Login is unavailable.")
  if (!data?.length)
    throw new DeviceLoginError(
      "invalid_code",
      "This code has expired or was already used.",
    )
}

/**
 * One poll from the CLI. Claims an approved row (so concurrent polls can't
 * mint twice), mints the key, and hands the claim back if minting fails so
 * the next poll can retry.
 */
export async function pollDeviceCode(deviceCode: string) {
  const hash = sha256(deviceCode)
  const { data: row, error } = await deviceTable()
    .select(
      "id, status, expires_at, user_id, team_id, team_region, client_name",
    )
    .eq("device_code", hash)
    .maybeSingle()
  if (error) throw new DeviceLoginError("unavailable", "Login is unavailable.")
  if (!row) throw new DeviceLoginError("invalid_grant", "Unknown login code.")
  if (row.status === "denied")
    throw new DeviceLoginError("access_denied", "The login was denied.")
  if (row.status === "consumed")
    throw new DeviceLoginError("invalid_grant", "This login was already used.")
  if (row.status === "pending") {
    if (new Date(row.expires_at as string).getTime() <= Date.now())
      throw new DeviceLoginError("expired_token", "The login code expired.")
    throw new DeviceLoginError(
      "authorization_pending",
      "Waiting for approval in the browser.",
    )
  }
  if (
    row.status !== "approved" ||
    new Date(row.expires_at as string).getTime() <= Date.now()
  )
    throw new DeviceLoginError("expired_token", "The login code expired.")

  const { data: claimed, error: claimError } = await deviceTable()
    .update({ status: "consumed", consumed_at: new Date().toISOString() })
    .eq("id", row.id)
    .eq("status", "approved")
    .gt("expires_at", new Date().toISOString())
    .select("id")
  if (claimError)
    throw new DeviceLoginError("unavailable", "Login is unavailable.")
  if (!claimed?.length)
    throw new DeviceLoginError("invalid_grant", "This login was already used.")

  const team = {
    teamId: row.team_id as string,
    region: row.team_region as string,
  }
  let minted: { apiKey: string; email: string | null }
  try {
    const {
      data: { user },
      error: userError,
    } = await createAdminClient().auth.admin.getUserById(row.user_id as string)
    // A failed lookup is retryable (the claim is handed back below); only a
    // lookup that finds no account ends the login.
    if (userError) throw new Error(`user lookup failed: ${userError.message}`)
    if (!user)
      throw new DeviceLoginError("access_denied", "The account is unavailable.")
    assertSignupReviewCleared(user)
    // Approval may predate a membership removal; check access as of now.
    if (!(await membershipExistsInCell(team.region, user.id, team.teamId)))
      throw new DeviceLoginError(
        "access_denied",
        "You no longer have access to that team.",
      )
    const key = await mintTeamApiKey(
      user,
      team,
      `CLI · ${row.client_name ?? "unknown device"}`,
      new Date().toISOString(),
    )
    minted = { apiKey: key.key, email: user.email ?? null }
  } catch (error) {
    if (
      !(error instanceof DeviceLoginError) &&
      !(error instanceof SignupReviewPendingError)
    ) {
      await restoreClaim(row.id as string)
    }
    throw error
  }
  return { ...minted, newAccount: await isNewTeam(team) }
}

// Hands a claim back so the next poll can retry minting. If every attempt
// fails the login is spent and the user has to run it again.
async function restoreClaim(id: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { error } = await deviceTable()
      .update({ status: "approved", consumed_at: null })
      .eq("id", id)
      .eq("status", "consumed")
    if (!error) return
    console.error("Device login claim restore failed", { error: error.message })
  }
}

/** Best effort: a failed lookup only means the CLI won't wait out a 402. */
async function isNewTeam(team: { teamId: string; region: string }) {
  try {
    const { data } = await cellFor(team.region)
      .createAdminClient()
      .from("team")
      .select("created_at")
      .eq("id", team.teamId)
      .maybeSingle()
    const createdAt = data?.created_at
      ? new Date(data.created_at as string).getTime()
      : Number.NaN
    return Date.now() - createdAt < NEW_ACCOUNT_WINDOW_MS
  } catch {
    return false
  }
}
