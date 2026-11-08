"use client"

import { useRouter } from "next/navigation"
import type { PostHog } from "posthog-js"
import { usePostHog } from "posthog-js/react"

import { markSigningOut } from "@/components/layout/session-expiry-redirect"
import { AUTH_EVENTS } from "@/lib/posthog/events"
import { createBrowserClient } from "@/lib/supabase/client"
import { clearTerminalTabsStorage } from "@/lib/terminal-tabs-storage"

/** Drops locally-scoped state tied to the previous user. */
export function clearAccountBrowserState(posthog: Pick<PostHog, "reset">) {
  clearTerminalTabsStorage()
  posthog.reset()
}

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
    clearAccountBrowserState(posthog)
    router.push("/auth/signin")
  }
}
