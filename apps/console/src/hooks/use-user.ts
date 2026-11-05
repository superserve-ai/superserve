"use client"

import { useEffect, useState } from "react"

import { createBrowserClient } from "@/lib/supabase/client"

type GetUserResult = Awaited<
  ReturnType<ReturnType<typeof createBrowserClient>["auth"]["getUser"]>
>
type User = GetUserResult["data"]["user"]

// Components mounting together share one lookup, so they queue once on the
// auth session lock instead of once each.
let inflight: Promise<GetUserResult> | undefined

function getUser(): Promise<GetUserResult> {
  if (!inflight) {
    const lookup = createBrowserClient().auth.getUser()
    inflight = lookup
    lookup
      .finally(() => {
        if (inflight === lookup) inflight = undefined
      })
      .catch(() => {})
  }
  return inflight
}

export function useUser() {
  const [user, setUser] = useState<User>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    getUser()
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
