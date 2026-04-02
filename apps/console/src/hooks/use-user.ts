"use client"

import type { User } from "@supabase/supabase-js"
import { createBrowserClient } from "@superserve/supabase"
import { useEffect, useState } from "react"

export function useUser() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createBrowserClient()
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user)
      setLoading(false)
    })
  }, [])

  return { user, loading }
}
