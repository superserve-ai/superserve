import type { User } from "@supabase/supabase-js"

const DEFAULT_STAFF_DOMAIN = "superserve.ai"

function staffDomain(): string {
  return (process.env.STAFF_EMAIL_DOMAIN ?? DEFAULT_STAFF_DOMAIN).toLowerCase()
}

/**
 * True only for a Google-verified identity on the staff domain. We require the
 * google provider so a spoofed email/password signup on @superserve.ai can't
 * gain admin access (the console supports email/password too).
 */
export function isStaff(
  user: Pick<User, "email" | "app_metadata"> | null | undefined,
): boolean {
  if (!user?.email) return false
  const provider = user.app_metadata?.provider as string | undefined
  const providers = user.app_metadata?.providers as string[] | undefined
  const viaGoogle =
    provider === "google" ||
    (Array.isArray(providers) && providers.includes("google"))
  if (!viaGoogle) return false
  return user.email.toLowerCase().endsWith(`@${staffDomain()}`)
}
