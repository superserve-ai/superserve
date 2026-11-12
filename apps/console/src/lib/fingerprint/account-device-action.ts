"use server"

import { getImpersonationTeamId } from "@/lib/admin/impersonation"
import { recordExistingAccountDevice } from "@/lib/api/promotion-device-evidence"
import { createServerClient } from "@/lib/supabase/server"

import { verifiedAccountDevice } from "./observe"

/** Best effort: a missing or unverifiable device never affects the session. */
export async function recordAccountDevice(eventId: string): Promise<boolean> {
  try {
    // Authenticate before spending a provider lookup on the request.
    const supabase = await createServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return false
    // An authorized impersonation would attribute the operator's device; a
    // stale cookie left for another account does not count.
    if ((await getImpersonationTeamId(user)) !== null) return false
    const fingerprint = await verifiedAccountDevice(eventId, user.id)
    return fingerprint
      ? await recordExistingAccountDevice(user.id, fingerprint)
      : false
  } catch {
    return false
  }
}
