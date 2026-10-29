import type { User } from "@supabase/supabase-js"

import { hasPrivilegedGoogleSession } from "@/lib/admin/google-session"
import { createServerClient } from "@/lib/supabase/server"

const DEFAULT_STAFF_DOMAIN = "superserve.ai"

function staffDomain(): string {
  return (process.env.STAFF_EMAIL_DOMAIN ?? DEFAULT_STAFF_DOMAIN).toLowerCase()
}

/**
 * True only for a staff-domain account linked to Google. Current-session
 * provenance is a separate authority checked by requireStaff.
 */
export function isStaff(user: User | null | undefined): boolean {
  if (!user?.email) return false
  const provider = user.app_metadata?.provider as string | undefined
  const providers = user.app_metadata?.providers as string[] | undefined
  const viaGoogle =
    provider === "google" ||
    (Array.isArray(providers) && providers.includes("google"))
  if (!viaGoogle) return false
  return user.email.toLowerCase().endsWith(`@${staffDomain()}`)
}

/** Guard for admin server actions and pages. Throws if not staff. */
export async function requireStaff(): Promise<User> {
  const supabase = await createServerClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()
  if (userError || !isStaff(user) || !(await hasPrivilegedGoogleSession(user)))
    throw new Error("Forbidden: staff access required")
  return user as User
}
