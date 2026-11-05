"use server"

import { createHash } from "node:crypto"

import { pickActiveTeam, writeTeamSelection } from "@/lib/api/active-team"
import { getAuthApiKeyAndTeamForUser } from "@/lib/api/proxy-auth"
import {
  invalidateMembershipDirectory,
  listTeamMembershipsForUserDetailed,
  listTeamsForUser,
  type TeamMembership,
} from "@/lib/api/team-directory"
import type {
  TeamInvitation,
  TeamInvitationDelivery,
  TeamScope,
} from "@/lib/api/team-management"
import { completedMemberships } from "@/lib/api/team-provisioning"
import { GoogleSignupRecoveryRequiredError } from "@/lib/auth/google-signup-proof"
import { inviteTokenRegion, isInviteToken } from "@/lib/auth/invite-return-path"
import {
  SIGNUP_RESTRICTED_MESSAGE,
  SignupRestrictedError,
} from "@/lib/auth/signup-restrictions"
import { cellFor, DEFAULT_REGION } from "@/lib/cells"
import { sendEmail } from "@/lib/email/send"
import {
  TeamInvitationEmail,
  teamInvitationSubject,
} from "@/lib/email/templates/team-invitation"
import { regionLabel } from "@/lib/format"
import { createServerClient } from "@/lib/supabase/server"

// Invite create/resend run here, on the server, because the backend returns
// the plaintext invite token exactly once and only the recipient may receive
// it (in the email link). Nothing in this file returns it to the browser.

export type InvitationErrorCode =
  | "free_plan"
  | "already_member"
  | "invitation_pending"
  | "pending_limit"
  | "rate_limited"
  | "bad_request"
  | "invitation_closed"
  | "last_owner"
  | "conflict"
  | "only_team"
  | "leave_in_progress"
  | "team_changed"
  | "forbidden"
  | "unauthorized"
  | "signup_blocked"
  | "google_signup_recovery_required"
  | "unavailable"

function isTeamScope(value: unknown): value is TeamScope {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as TeamScope).teamId === "string" &&
    typeof (value as TeamScope).region === "string"
  )
}

export type InvitationActionError = {
  ok: false
  code: InvitationErrorCode
  message: string
}

export type SendInvitationResult =
  | {
      ok: true
      invitation: TeamInvitation
      delivery: "sent" | "failed"
    }
  | InvitationActionError

const MESSAGES: Record<InvitationErrorCode, string> = {
  free_plan: "Upgrade to invite owners",
  already_member: "That person is already a member of this team.",
  invitation_pending:
    "That email already has an invitation that hasn't been accepted, including expired ones. Resend or revoke it in the list below.",
  pending_limit:
    "This team has the maximum number of pending invitations. Revoke one to send another.",
  rate_limited: "Too many invitations were sent recently. Try again later.",
  bad_request: "Enter a valid email address.",
  invitation_closed: "That invitation is no longer pending.",
  last_owner:
    "A team needs at least one owner. Make someone else an owner first.",
  conflict: "You are no longer an active member of this team.",
  only_team: "You can't leave your only team.",
  leave_in_progress: "Another leave is in progress. Try again in a moment.",
  team_changed: "Your active team changed. Reload the page and try again.",
  forbidden: "You don't have permission to do that.",
  unauthorized: "Your session has expired. Sign in again.",
  signup_blocked: SIGNUP_RESTRICTED_MESSAGE,
  google_signup_recovery_required: "Complete signup with Google to continue.",
  unavailable: "Something went wrong. Please try again.",
}

function failure(code: InvitationErrorCode): InvitationActionError {
  return { ok: false, code, message: MESSAGES[code] }
}

const BACKEND_CODES: readonly InvitationErrorCode[] = [
  "free_plan",
  "already_member",
  "invitation_pending",
  "pending_limit",
  "rate_limited",
  "bad_request",
  "invitation_closed",
  "last_owner",
  "conflict",
]

async function errorFromResponse(
  response: Response,
): Promise<InvitationActionError> {
  const body = (await response.json().catch(() => null)) as {
    error?: { code?: unknown }
  } | null
  const code = body?.error?.code
  const known = BACKEND_CODES.find((candidate) => candidate === code)
  if (known) return failure(known)
  if (response.status === 401) return failure("unauthorized")
  if (response.status === 403) return failure("forbidden")
  if (response.status === 429) return failure("rate_limited")
  return failure("unavailable")
}

interface Context {
  userId: string
  userLabel: string
  apiKey: string
  team: TeamMembership
  baseUrl: string
}

/**
 * `expected` is the team the page was showing. The active team comes from a
 * cookie that another tab can move, so a mismatch is refused rather than
 * letting the action land on a team the user is not looking at.
 */
async function loadContext(
  expected: TeamScope,
): Promise<Context | InvitationActionError> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return failure("unauthorized")
  try {
    const { apiKey, team } = await getAuthApiKeyAndTeamForUser(
      user,
      new Date().toISOString(),
    )
    if (
      !isTeamScope(expected) ||
      team.teamId !== expected.teamId ||
      team.region !== expected.region
    ) {
      return failure("team_changed")
    }
    return {
      userId: user.id,
      userLabel:
        (user.user_metadata?.full_name as string | undefined) ||
        (user.user_metadata?.name as string | undefined) ||
        user.email ||
        "A teammate",
      apiKey,
      team,
      baseUrl: cellFor(team.region).apiBaseUrl,
    }
  } catch (error) {
    if (error instanceof GoogleSignupRecoveryRequiredError) {
      return failure("google_signup_recovery_required")
    }
    if (error instanceof SignupRestrictedError) return failure("signup_blocked")
    return failure("unavailable")
  }
}

function isFailure(
  value: Context | InvitationActionError,
): value is InvitationActionError {
  return "ok" in value
}

function teamPath(context: Context, suffix: string): string {
  return `${context.baseUrl}/teams/${encodeURIComponent(context.team.teamId)}${suffix}`
}

async function backend(
  context: Context,
  suffix: string,
  body?: unknown,
): Promise<Response | null> {
  try {
    return await fetch(teamPath(context, suffix), {
      method: "POST",
      headers: {
        "X-API-Key": context.apiKey,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    return null
  }
}

// Explicit pick: the browser gets these fields and nothing the backend added.
function toInvitation(raw: unknown): TeamInvitation | null {
  if (typeof raw !== "object" || raw === null) return null
  const r = raw as Record<string, unknown>
  if (
    typeof r.id !== "string" ||
    typeof r.email !== "string" ||
    typeof r.status !== "string" ||
    typeof r.created_at !== "string" ||
    typeof r.expires_at !== "string"
  ) {
    return null
  }
  const delivery = r.delivery_status
  return {
    id: r.id,
    email: r.email,
    status: r.status as TeamInvitation["status"],
    invited_by: typeof r.invited_by === "string" ? r.invited_by : null,
    created_at: r.created_at,
    expires_at: r.expires_at,
    last_sent_at: typeof r.last_sent_at === "string" ? r.last_sent_at : null,
    delivery_status:
      delivery === "sent" || delivery === "failed" || delivery === "pending"
        ? delivery
        : "pending",
  }
}

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "https://console.superserve.ai"
}

function formatExpiry(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })
}

async function teamName(context: Context): Promise<string> {
  try {
    const teams = await listTeamsForUser(context.userId)
    const match = teams.find(
      (team) =>
        team.id === context.team.teamId && team.region === context.team.region,
    )
    if (match?.name) return match.name
  } catch {
    // The name only decorates the email; fall through to a generic one.
  }
  return "a team"
}

// First 16 hex chars of the SHA-256 of the full token. The backend ignores a
// report whose prefix no longer matches, so a slow report from an earlier send
// cannot overwrite the status of a newer resend.
function tokenHashPrefix(token: unknown): string | undefined {
  if (typeof token !== "string" || !token) return undefined
  return createHash("sha256").update(token).digest("hex").slice(0, 16)
}

async function reportDelivery(
  context: Context,
  invitationId: string,
  status: Exclude<TeamInvitationDelivery, "pending">,
  token: unknown,
): Promise<void> {
  const response = await backend(
    context,
    `/invitations/${encodeURIComponent(invitationId)}/delivery`,
    { status, token_hash_prefix: tokenHashPrefix(token) },
  )
  if (!response || !response.ok) {
    console.warn("Invitation delivery status was not recorded")
  }
}

async function createOrResend(
  expected: TeamScope,
  suffix: string,
  body: unknown,
): Promise<SendInvitationResult> {
  const context = await loadContext(expected)
  if (isFailure(context)) return context

  const response = await backend(context, suffix, body)
  if (!response) return failure("unavailable")
  if (!response.ok) return errorFromResponse(response)

  const data = (await response.json().catch(() => null)) as {
    invitation?: unknown
    token?: unknown
  } | null
  const invitation = toInvitation(data?.invitation)
  if (!invitation) return failure("unavailable")

  const token = data?.token
  // The region is part of the token; a token for another cell would send the
  // recipient to the wrong place, so treat it as undeliverable.
  const deliverable =
    isInviteToken(token) && inviteTokenRegion(token) === context.team.region
  let delivery: "sent" | "failed" = "failed"
  if (deliverable) {
    const name = await teamName(context)
    const sent = await sendEmail({
      to: invitation.email,
      subject: teamInvitationSubject(name),
      react: TeamInvitationEmail({
        teamName: name,
        regionLabel: regionLabel(context.team.region),
        inviterName: context.userLabel,
        expiresOn: formatExpiry(invitation.expires_at),
        inviteUrl: `${appUrl()}/invite/${token}/`,
      }),
    })
    if (sent.success) delivery = "sent"
  }
  await reportDelivery(context, invitation.id, delivery, token)

  return {
    ok: true,
    invitation: { ...invitation, delivery_status: delivery },
    delivery,
  }
}

export async function createInvitationAction(
  expected: TeamScope,
  email: string,
): Promise<SendInvitationResult> {
  const normalized = typeof email === "string" ? email.trim() : ""
  if (!normalized || normalized.length > 320 || !normalized.includes("@")) {
    return failure("bad_request")
  }
  return createOrResend(expected, "/invitations", { email: normalized })
}

export async function resendInvitationAction(
  expected: TeamScope,
  invitationId: string,
): Promise<SendInvitationResult> {
  if (typeof invitationId !== "string" || !/^[\w-]{1,64}$/.test(invitationId)) {
    return failure("bad_request")
  }
  return createOrResend(
    expected,
    `/invitations/${encodeURIComponent(invitationId)}/resend`,
    undefined,
  )
}

export async function revokeInvitationAction(
  expected: TeamScope,
  invitationId: string,
): Promise<{ ok: true } | InvitationActionError> {
  if (typeof invitationId !== "string" || !/^[\w-]{1,64}$/.test(invitationId)) {
    return failure("bad_request")
  }
  const context = await loadContext(expected)
  if (isFailure(context)) return context
  const response = await backend(
    context,
    `/invitations/${encodeURIComponent(invitationId)}/revoke`,
  )
  if (!response) return failure("unavailable")
  if (!response.ok) return errorFromResponse(response)
  return { ok: true }
}

// Departures are serialized per user across instances and regions with a
// lease in the default cell (one global lock per user). It must outlast the
// worst case of the membership read plus the 15s backend leave call; the TTL
// also frees the lock if a release is lost.
const LEAVE_LEASE_TTL_SECONDS = 60
// The backend leave call must start early enough to finish (15s timeout)
// before the lease can expire, with a margin for clock and network skew.
const LEAVE_START_DEADLINE_MS = 40_000

async function acquireLeaveLease(
  userId: string,
  holder: string,
): Promise<boolean> {
  try {
    const { data, error } = await cellFor(DEFAULT_REGION)
      .createAdminClient()
      .rpc("acquire_team_leave_lease", {
        p_user_id: userId,
        p_holder: holder,
        p_ttl_seconds: LEAVE_LEASE_TTL_SECONDS,
      })
    return !error && data === true
  } catch {
    return false
  }
}

async function releaseLeaveLease(
  userId: string,
  holder: string,
): Promise<void> {
  try {
    const { error } = await cellFor(DEFAULT_REGION)
      .createAdminClient()
      .rpc("release_team_leave_lease", { p_user_id: userId, p_holder: holder })
    if (error) throw new Error(error.message)
  } catch (error) {
    // The TTL expires the lease; a failed release only delays the next leave.
    console.error("team leave: lease release failed:", error)
  }
}

/**
 * Leaves the active team. The only-team rule is enforced here, not in the
 * backend, because this server owns the cross-region membership directory.
 * An ambiguous directory read fails closed. Departures are serialized per
 * user by a lease so the fresh membership check and the leave cannot overlap
 * with another leave (otherwise two teams could both pass the check and the
 * user would end up with none).
 */
export async function leaveTeamAction(
  expected: TeamScope,
): Promise<{ ok: true } | InvitationActionError> {
  const context = await loadContext(expected)
  if (isFailure(context)) return context

  const holder = crypto.randomUUID()
  // Taken before the acquire call so the deadline errs on the early side.
  const deadline = Date.now() + LEAVE_START_DEADLINE_MS
  if (!(await acquireLeaveLease(context.userId, holder))) {
    return failure("leave_in_progress")
  }
  const outcome = { unknown: false }
  try {
    return await leaveWithLease(context, deadline, outcome)
  } finally {
    // A leave with no answer or a 5xx can still commit, so the lease is left
    // to expire rather than letting another leave read the directory before
    // it lands.
    if (!outcome.unknown) await releaseLeaveLease(context.userId, holder)
  }
}

async function leaveWithLease(
  context: Context,
  deadline: number,
  outcome: { unknown: boolean },
): Promise<{ ok: true } | InvitationActionError> {
  let remaining: TeamMembership[]
  try {
    const directory = await listTeamMembershipsForUserDetailed(context.userId, {
      strict: true,
    })
    const completed = await completedMemberships(context.userId, directory)
    if (
      directory.degradedRegions.length > 0 ||
      completed.degradedRegions.length > 0
    ) {
      return failure("only_team")
    }
    remaining = completed.memberships.filter(
      (m) =>
        m.teamId !== context.team.teamId || m.region !== context.team.region,
    )
  } catch {
    return failure("only_team")
  }
  if (remaining.length === 0) return failure("only_team")
  // A lease that may have lapsed no longer excludes another leave's check.
  if (Date.now() > deadline) return failure("unavailable")

  const response = await backend(context, "/leave")
  if (!response) {
    outcome.unknown = true
    return failure("unavailable")
  }
  if (response.status >= 500) {
    outcome.unknown = true
    return failure("unavailable")
  }
  if (!response.ok) return errorFromResponse(response)

  invalidateMembershipDirectory(context.userId)
  const next = pickActiveTeam(remaining, null)
  if (next) {
    await writeTeamSelection({ region: next.region, teamId: next.teamId })
  }
  return { ok: true }
}
