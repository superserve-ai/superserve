import "server-only"
import { inviteTokenRegion } from "@/lib/auth/invite-return-path"
import { cellFor, internalApiTokenFor } from "@/lib/cells"

export interface InvitePreview {
  invitationId: string
  teamId: string
  teamName: string
  region: string
  email: string
  expiresAt: string
  status: string
  available: boolean
}

export type InvitePreviewResult =
  | { ok: true; preview: InvitePreview }
  // Unknown, malformed, unreachable and misconfigured all look the same to the
  // caller: the page never explains why a link stopped working.
  | { ok: false }

export type InviteAcceptError =
  | "unavailable"
  | "email_mismatch"
  | "email_unverified"
  | "already_member"

export type InviteAcceptResult =
  | {
      ok: true
      result: "joined" | "already_owner"
      teamId: string
      teamName: string
      region: string
    }
  | { ok: false; error: InviteAcceptError }

const REQUEST_TIMEOUT_MS = 8000

async function internalPost(
  region: string,
  path: string,
  body: unknown,
): Promise<Response | null> {
  const token = internalApiTokenFor(region)
  if (!token) return null
  try {
    return await fetch(new URL(path, cellFor(region).apiBaseUrl), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch {
    return null
  }
}

function str(value: unknown): string | null {
  return typeof value === "string" && value ? value : null
}

export async function previewInvitation(
  token: string,
): Promise<InvitePreviewResult> {
  const region = inviteTokenRegion(token)
  if (!region) return { ok: false }
  const response = await internalPost(
    region,
    "/internal/team-invitations/preview",
    { token },
  )
  if (!response || response.status !== 200) return { ok: false }
  const data = (await response.json().catch(() => null)) as Record<
    string,
    unknown
  > | null
  const invitationId = str(data?.invitation_id)
  const teamId = str(data?.team_id)
  const teamName = str(data?.team_name)
  const email = str(data?.email)
  const expiresAt = str(data?.expires_at)
  const status = str(data?.status)
  if (
    !invitationId ||
    !teamId ||
    !teamName ||
    !email ||
    !expiresAt ||
    !status ||
    typeof data?.available !== "boolean"
  ) {
    return { ok: false }
  }
  return {
    ok: true,
    preview: {
      invitationId,
      teamId,
      teamName,
      // The token already fixes the region; never trust a different value
      // echoed back by the cell.
      region,
      email,
      expiresAt,
      status,
      available: data.available,
    },
  }
}

export async function acceptInvitation(
  token: string,
  user: { id: string; email: string },
): Promise<InviteAcceptResult> {
  const region = inviteTokenRegion(token)
  if (!region) return { ok: false, error: "unavailable" }
  const response = await internalPost(
    region,
    "/internal/team-invitations/accept",
    {
      token,
      user_id: user.id,
      email: user.email,
      email_verified: true,
    },
  )
  if (!response) return { ok: false, error: "unavailable" }
  const data = (await response.json().catch(() => null)) as Record<
    string,
    unknown
  > | null
  if (response.status === 200) {
    const teamId = str(data?.team_id)
    const teamName = str(data?.team_name)
    const result = data?.result
    if (
      !teamId ||
      !teamName ||
      (result !== "joined" && result !== "already_owner")
    ) {
      return { ok: false, error: "unavailable" }
    }
    return { ok: true, result, teamId, teamName, region }
  }
  // 404 and 410 both mean the invitation is gone; anything unrecognised is
  // reported the same way so the page never explains why a link stopped working.
  const error = data?.error
  const code =
    typeof error === "object" && error
      ? (error as { code?: unknown }).code
      : (data?.code ?? error)
  if (
    code === "email_mismatch" ||
    code === "email_unverified" ||
    code === "already_member"
  ) {
    return { ok: false, error: code }
  }
  return { ok: false, error: "unavailable" }
}
