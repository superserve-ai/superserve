import "server-only"
import { cookies } from "next/headers"

import { createAdminClient } from "@/lib/supabase/admin"
import { createServerClient } from "@/lib/supabase/server"

import {
  lookupEnterpriseMeeting,
  type EnterpriseMeeting,
} from "./enterprise-meeting"
import {
  PENDING_MEETING_COOKIE,
  verifyPendingMeetingContext,
} from "./pending-meeting-context"
import { isSignupReviewBlocked } from "./signup-review"

export async function readPendingMeeting(): Promise<
  EnterpriseMeeting & { accountEmail?: string }
> {
  const userId = await verifyPendingMeetingContext(
    (await cookies()).get(PENDING_MEETING_COOKIE)?.value,
  )
  if (!userId) return { state: "signin_required" }
  try {
    const session = await createServerClient()
    const {
      data: { user: current },
      error: sessionError,
    } = await session.auth.getUser()
    if (sessionError && current) return { state: "unavailable" }
    if (current && current.id !== userId) return { state: "signin_required" }
    const {
      data: { user },
      error,
    } = await createAdminClient().auth.admin.getUserById(userId)
    if (
      error ||
      !user?.email ||
      !user.email_confirmed_at ||
      !isSignupReviewBlocked(user)
    )
      return { state: "signin_required" }
    return {
      ...(await lookupEnterpriseMeeting(user.email)),
      accountEmail: user.email,
    }
  } catch {
    return { state: "unavailable" }
  }
}
