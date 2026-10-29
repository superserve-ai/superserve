import type { User } from "@supabase/supabase-js"

import { hasPrivilegedGoogleSession } from "@/lib/admin/google-session"
import { createServerClient } from "@/lib/supabase/server"

import { isStaff } from "./staff-identity"

export { isStaff } from "./staff-identity"

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
