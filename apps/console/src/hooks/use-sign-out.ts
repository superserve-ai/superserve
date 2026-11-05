"use client"

import { useRouter } from "next/navigation"
import { usePostHog } from "posthog-js/react"

import { markSigningOut } from "@/components/layout/session-expiry-redirect"
import { AUTH_EVENTS } from "@/lib/posthog/events"
import { createBrowserClient } from "@/lib/supabase/client"
import { clearTerminalTabsStorage } from "@/lib/terminal-tabs-storage"

export function useSignOut() {
  const router = useRouter()
  const posthog = usePostHog()
  return async () => {
    posthog.capture(AUTH_EVENTS.SIGN_OUT)
    markSigningOut()
    try {
      await createBrowserClient().auth.signOut()
    } catch {
      // Sign out failed, but redirect to sign-in anyway
    }
    // Drop any locally-scoped state tied to the previous user.
    clearTerminalTabsStorage()
    posthog.reset()
    router.push("/auth/signin")
  }
}
