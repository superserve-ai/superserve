"use client"

import { useRouter } from "next/navigation"
import type { PostHog } from "posthog-js"
import { usePostHog } from "posthog-js/react"

import {
  clearSigningOut,
  markSigningOut,
} from "@/components/layout/session-expiry-redirect"
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
  return async (next?: string) => {
    posthog.capture(AUTH_EVENTS.SIGN_OUT)
    markSigningOut()
    try {
      const { error } = await createBrowserClient().auth.signOut()
      if (next && error) throw error
    } catch {
      if (next) {
        clearSigningOut()
        throw new Error("Unable to sign out. Try again.")
      }
      // Sign out failed, but redirect to sign-in anyway
    }
    clearAccountBrowserState(posthog)
    router.push(
      next ? `/auth/signin?next=${encodeURIComponent(next)}` : "/auth/signin",
    )
  }
}
