import { notFound } from "next/navigation"

import { createServerClient } from "@/lib/supabase/server"

import { TeamClient } from "./team-client"

export const metadata = { title: "Team" }

// Open to any signed-in user. What they can do on the page comes from the
// team capabilities the backend returns, not from a platform permission.
export default async function TeamPage() {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    notFound()
  }

  return <TeamClient />
}
