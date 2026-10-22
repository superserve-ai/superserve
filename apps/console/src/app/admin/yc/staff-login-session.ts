import "server-only"
import { getImpersonationContext } from "@/lib/admin/impersonation"
import { isStaff } from "@/lib/admin/staff"
import { createServerClient } from "@/lib/supabase/server"
import { claimID } from "@/lib/yc/staff-schema"

export function staffReviewPath(claim?: string) {
  const locator = claimID.safeParse(claim)
  return locator.success ? `/admin/yc?claim=${locator.data}` : "/admin/yc"
}

export async function staffLoginSession() {
  try {
    const client = await createServerClient()
    const {
      data: { user },
      error,
    } = await client.auth.getUser()
    if (error || !user) return { kind: "signin" as const }
    if (!isStaff(user)) return { kind: "nonstaff" as const }
    if (await getImpersonationContext(user))
      return { kind: "impersonating" as const }
    return { kind: "eligible" as const, client, user }
  } catch {
    console.error("Staff sign-in eligibility check failed")
    return { kind: "unavailable" as const }
  }
}
