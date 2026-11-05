"use server"

import { redirect } from "next/navigation"

import { invitePath, isInviteToken } from "@/lib/auth/invite-return-path"
import { acceptInviteAndSelectTeam, loadInviteView } from "@/lib/invite/accept"
import { failureForAcceptError } from "@/lib/invite/decision"
import { clearInviteIntent, setInviteIntent } from "@/lib/invite/intent"
import { createServerClient } from "@/lib/supabase/server"

// "reload" re-renders the invite page in place, which decides what to show.
export type InviteActionResult =
  | { status: "redirect"; to: string }
  | { status: "reload" }
  | {
      status: "error"
      code:
        | "unavailable"
        | "already_member"
        | "email_mismatch"
        | "not_eligible"
        | "failed"
    }

async function acceptForSignedInUser(
  token: string,
  { auto }: { auto: boolean },
): Promise<InviteActionResult> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { status: "reload" }
  if (!user.email || !user.email_confirmed_at) {
    return { status: "error", code: "unavailable" }
  }

  // The silent path re-decides here, with a fresh team read and the intent
  // cookie, rather than trusting whatever the page rendered. Anything else
  // goes back to the page, which shows the confirm screen.
  if (auto) {
    const { view } = await loadInviteView(token)
    if (view.kind !== "auto_accept") return { status: "reload" }
  }

  let result: Awaited<ReturnType<typeof acceptInviteAndSelectTeam>>
  try {
    result = await acceptInviteAndSelectTeam(token, user)
  } catch {
    return { status: "error", code: "failed" }
  }
  if (!result.ok) {
    // A retryable failure stays on the page with Join, never ?failed=.
    if (result.error === "retry") return { status: "error", code: "failed" }
    return { status: "error", code: failureForAcceptError(result.error) }
  }
  await clearInviteIntent()
  return { status: "redirect", to: "/sandboxes" }
}

/**
 * Explicit "Join team" from the confirm screen. Success hands back where to go
 * next; a definitive refusal is sent to the invite page, which explains it.
 * Server actions are same-origin only, so a link on another site cannot post it.
 */
export async function joinInviteAction(
  token: string,
): Promise<InviteActionResult> {
  if (!invitePath(token)) return { status: "error", code: "unavailable" }
  return acceptForSignedInUser(token, { auto: false })
}

/**
 * Join without a click for a new account that started signup or sign-in from
 * this invite page. It only proceeds while the intent cookie for this token is
 * present and the account still has no team.
 */
export async function autoJoinInviteAction(
  token: string,
): Promise<InviteActionResult> {
  if (!invitePath(token)) return { status: "error", code: "unavailable" }
  return acceptForSignedInUser(token, { auto: true })
}

/** Records that signup or sign-in began here, then continues to that screen. */
export async function beginInviteAuthAction(
  token: string,
  mode: "signup" | "signin",
): Promise<void> {
  const path = invitePath(token)
  if (!path) redirect("/")
  await setInviteIntent(token)
  redirect(
    `/auth/${mode === "signup" ? "signup" : "signin"}?next=${encodeURIComponent(path)}`,
  )
}

/** Mismatch screen: end this session and return to the invite signed out. */
export async function signOutForInviteAction(
  token: string,
): Promise<{ status: "redirect"; to: string } | { status: "error" }> {
  const path = isInviteToken(token) ? invitePath(token) : null
  if (!path) return { status: "error" }
  try {
    const supabase = await createServerClient()
    const { error } = await supabase.auth.signOut()
    if (error) return { status: "error" }
    await setInviteIntent(token)
  } catch {
    return { status: "error" }
  }
  return {
    status: "redirect",
    to: `/auth/signin?next=${encodeURIComponent(path)}`,
  }
}
