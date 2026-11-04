"use server"

import { invitePath, isInviteToken } from "@/lib/auth/invite-return-path"
import { acceptInviteAndSelectTeam } from "@/lib/invite/accept"
import { failureForAcceptError } from "@/lib/invite/decision"
import { createServerClient } from "@/lib/supabase/server"

export type InviteActionResult =
  | { status: "redirect"; to: string }
  | {
      status: "error"
      code: "unavailable" | "already_member" | "email_mismatch" | "failed"
    }

/**
 * Explicit "Join team" from the confirm screen. Success hands back where to go
 * next; a definitive refusal is sent to the invite page, which explains it.
 */
export async function joinInviteAction(
  token: string,
): Promise<InviteActionResult> {
  const path = isInviteToken(token) ? invitePath(token) : null
  if (!path) return { status: "error", code: "unavailable" }

  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { status: "redirect", to: `${path}/` }
  if (!user.email || !user.email_confirmed_at) {
    return { status: "error", code: "unavailable" }
  }

  let result: Awaited<ReturnType<typeof acceptInviteAndSelectTeam>>
  try {
    result = await acceptInviteAndSelectTeam(token, {
      id: user.id,
      email: user.email,
    })
  } catch {
    return { status: "error", code: "failed" }
  }
  if (!result.ok) {
    return { status: "error", code: failureForAcceptError(result.error) }
  }
  return { status: "redirect", to: "/sandboxes" }
}

/** Mismatch screen: end this session and return to the invite signed out. */
export async function signOutForInviteAction(
  token: string,
): Promise<{ status: "redirect"; to: string } | { status: "error" }> {
  const path = isInviteToken(token) ? invitePath(token) : null
  if (!path) return { status: "error" }
  try {
    const supabase = await createServerClient()
    await supabase.auth.signOut()
  } catch {
    return { status: "error" }
  }
  return {
    status: "redirect",
    to: `/auth/signin?next=${encodeURIComponent(path)}`,
  }
}
