"use client"

import type { PostHog } from "posthog-js"
import { usePostHog } from "posthog-js/react"
import { useEffect, useState } from "react"

function flagOn(client: PostHog, flag: string): boolean {
  try {
    return client.isFeatureEnabled(flag) === true
  } catch {
    return false
  }
}

// True only when PostHog has loaded the flag and it is on. A missing client,
// a flag that is not loaded or not defined, and any SDK error all read as off.
// The flag is read only while `enabled`, so PostHog records an exposure only
// for users the flag can change.
export function useFeatureFlagOn(flag: string, enabled = true): boolean {
  const posthog = usePostHog() as PostHog | undefined
  const [on, setOn] = useState(false)
  useEffect(() => {
    if (!enabled || !posthog) {
      setOn(false)
      return
    }
    setOn(flagOn(posthog, flag))
    let unsubscribe: (() => void) | undefined
    try {
      unsubscribe = posthog.onFeatureFlags(() => setOn(flagOn(posthog, flag)))
    } catch {
      // Keep the value read above.
    }
    return () => {
      try {
        unsubscribe?.()
      } catch {
        // Nothing to clean up.
      }
    }
  }, [posthog, flag, enabled])
  return enabled && on
}
