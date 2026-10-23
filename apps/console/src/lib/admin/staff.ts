import type { User } from "@supabase/supabase-js"

import { createServerClient } from "@/lib/supabase/server"

import { isStaff } from "./staff-identity"

export { isStaff }

/** Guard for admin server actions and pages. Throws if not staff. */
export async function requireStaff(): Promise<User> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!isStaff(user)) throw new Error("Forbidden: staff access required")
  return user as User
}
