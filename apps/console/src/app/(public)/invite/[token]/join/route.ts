import { redirect } from "next/navigation"
import type { NextRequest } from "next/server"

import { invitePath } from "@/lib/auth/invite-return-path"
import { acceptInviteAndSelectTeam, loadInviteView } from "@/lib/invite/accept"
import { failureForAcceptError } from "@/lib/invite/decision"

// Automatic join for an account with no team yet (a new signup that arrived
// through the invite link). It lives in a route handler because rendering the
// page cannot set the active-team cookie. Anything that is not exactly that
// case goes back to the page, which decides what to show.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<never> {
  const { token } = await params
  const path = invitePath(token)
  if (!path) redirect("/")

  const { view, user } = await loadInviteView(token)
  if (view.kind !== "auto_accept" || !user) redirect(`${path}/`)

  const result = await acceptInviteAndSelectTeam(token, user)
  if (!result.ok) {
    redirect(`${path}/?failed=${failureForAcceptError(result.error)}`)
  }
  redirect("/sandboxes")
}
