import type { User } from "@supabase/supabase-js"

import { canViewOtherUsersAccount } from "@/lib/admin/permissions"
import { createServerClient } from "@/lib/supabase/server"

export { canViewOtherUsersAccount }

const DEFAULT_STAFF_DOMAIN = "superserve.ai"

function staffDomain(): string {
  return (process.env.STAFF_EMAIL_DOMAIN ?? DEFAULT_STAFF_DOMAIN).toLowerCase()
}

/**
 * True only for a Google-verified identity on the staff domain. We require the
 * google provider so a spoofed email/password signup on @superserve.ai can't
 * gain admin access (the console supports email/password too).
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

export function canImpersonateUsers(user: User | null | undefined): boolean {
  return isStaff(user) && canViewOtherUsersAccount(user)
}

/** Guard for admin server actions and pages. Throws if not staff. */
export async function requireStaff(): Promise<User> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!isStaff(user)) throw new Error("Forbidden: staff access required")
  return user as User
}

/** Guard for impersonation admin surfaces. Throws unless staff with users:read. */
export async function requireImpersonationAccess(): Promise<User> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!canImpersonateUsers(user)) {
    throw new Error("Forbidden: users:read access required")
  }
  return user as User
}
