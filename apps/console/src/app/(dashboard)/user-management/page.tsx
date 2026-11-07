import { notFound } from "next/navigation"

import { createServerClient } from "@/lib/supabase/server"

import { UserManagementClient } from "./user-management-client"

// Open to any signed-in user. What they can do on the page comes from the
// team capabilities the backend returns, not from a platform permission.
export default async function UserManagementPage() {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    notFound()
  }

  return <UserManagementClient />
}
