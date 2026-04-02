"use client"

import type { User } from "@supabase/supabase-js"
import { createBrowserClient } from "@superserve/supabase"
import { useEffect, useState } from "react"

export function useUser() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    const supabase = createBrowserClient()
    supabase.auth
      .getUser()
      .then(({ data: { user }, error }) => {
        if (error) throw error
        setUser(user)
      })
      .catch((err) =>
        setError(err instanceof Error ? err : new Error(String(err))),
      )
      .finally(() => setLoading(false))
  }, [])

  return { user, loading, error }
}
