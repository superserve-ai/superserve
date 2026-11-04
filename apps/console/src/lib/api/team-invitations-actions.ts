"use server"

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
} from "@/lib/api/team-management"
import { completedMemberships } from "@/lib/api/team-provisioning"
import { GoogleSignupRecoveryRequiredError } from "@/lib/auth/google-signup-proof"
import { inviteTokenRegion, isInviteToken } from "@/lib/auth/invite-return-path"
import {
  SIGNUP_RESTRICTED_MESSAGE,
  SignupRestrictedError,
} from "@/lib/auth/signup-restrictions"
import { cellFor } from "@/lib/cells"
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
  | "only_team"
  | "forbidden"
  | "unauthorized"
  | "signup_blocked"
  | "google_signup_recovery_required"
  | "unavailable"

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
    "An invitation to that email is already pending. Resend it instead.",
  pending_limit:
    "This team has the maximum number of pending invitations. Revoke one to send another.",
  rate_limited: "Too many invitations were sent recently. Try again later.",
  bad_request: "Enter a valid email address.",
  invitation_closed: "That invitation is no longer pending.",
  last_owner:
    "A team needs at least one owner. Make someone else an owner first.",
  only_team: "You can't leave your only team.",
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

async function loadContext(): Promise<Context | InvitationActionError> {
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

async function reportDelivery(
  context: Context,
  invitationId: string,
  status: Exclude<TeamInvitationDelivery, "pending">,
): Promise<void> {
  const response = await backend(
    context,
    `/invitations/${encodeURIComponent(invitationId)}/delivery`,
    { status },
  )
  if (!response || !response.ok) {
    console.warn("Invitation delivery status was not recorded")
  }
}

async function createOrResend(
  suffix: string,
  body: unknown,
): Promise<SendInvitationResult> {
  const context = await loadContext()
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
  await reportDelivery(context, invitation.id, delivery)

  return {
    ok: true,
    invitation: { ...invitation, delivery_status: delivery },
    delivery,
  }
}

export async function createInvitationAction(
  email: string,
): Promise<SendInvitationResult> {
  const normalized = typeof email === "string" ? email.trim() : ""
  if (!normalized || normalized.length > 320 || !normalized.includes("@")) {
    return failure("bad_request")
  }
  return createOrResend("/invitations", { email: normalized })
}

export async function resendInvitationAction(
  invitationId: string,
): Promise<SendInvitationResult> {
  if (typeof invitationId !== "string" || !/^[\w-]{1,64}$/.test(invitationId)) {
    return failure("bad_request")
  }
  return createOrResend(
    `/invitations/${encodeURIComponent(invitationId)}/resend`,
    undefined,
  )
}

export async function revokeInvitationAction(
  invitationId: string,
): Promise<{ ok: true } | InvitationActionError> {
  if (typeof invitationId !== "string" || !/^[\w-]{1,64}$/.test(invitationId)) {
    return failure("bad_request")
  }
  const context = await loadContext()
  if (isFailure(context)) return context
  const response = await backend(
    context,
    `/invitations/${encodeURIComponent(invitationId)}/revoke`,
  )
  if (!response) return failure("unavailable")
  if (!response.ok) return errorFromResponse(response)
  return { ok: true }
}

/**
 * Leaves the active team. The only-team rule is enforced here, not in the
 * backend, because this server owns the cross-region membership directory.
 * An ambiguous directory read fails closed.
 */
export async function leaveTeamAction(): Promise<
  { ok: true; next: { teamId: string; region: string } } | InvitationActionError
> {
  const context = await loadContext()
  if (isFailure(context)) return context

  let remaining: TeamMembership[]
  try {
    const directory = await listTeamMembershipsForUserDetailed(context.userId, {
      maxAgeMs: 0,
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

  const response = await backend(context, "/leave")
  if (!response) return failure("unavailable")
  if (!response.ok) return errorFromResponse(response)

  invalidateMembershipDirectory(context.userId)
  const next = pickActiveTeam(remaining, null) ?? remaining[0]
  await writeTeamSelection({ region: next.region, teamId: next.teamId })
  return { ok: true, next: { teamId: next.teamId, region: next.region } }
}
