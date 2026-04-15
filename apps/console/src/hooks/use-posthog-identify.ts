"use client"

import { usePostHog } from "posthog-js/react"
import { useEffect, useRef } from "react"
import { useUser } from "@/hooks/use-user"

export function usePostHogIdentify() {
  const { user, loading } = useUser()
  const posthog = usePostHog()
  const identifiedRef = useRef<string | null>(null)

  useEffect(() => {
    if (loading || !posthog) return

    if (user && identifiedRef.current !== user.id) {
      posthog.identify(user.id, {
        email: user.email,
        name: user.user_metadata?.full_name,
        provider: user.app_metadata?.provider,
      })
      identifiedRef.current = user.id
    }

    if (!user && identifiedRef.current) {
      posthog.reset()
      identifiedRef.current = null
    }
  }, [user, loading, posthog])
}
