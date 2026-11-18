"use client"

import type { PostHog } from "posthog-js"
import { usePostHog } from "posthog-js/react"
import { useEffect, useState } from "react"

function flagOn(client: PostHog, flag: string): boolean {
  try {
    // PostHog keeps the last value of a flag that failed to evaluate, and
    // lists the errors of the last flags request in this property.
    const errors: unknown = client.get_property("$feature_flag_errors")
    if (Array.isArray(errors) && errors.length > 0) return false
    // `fresh` skips values cached from an earlier page load, so a failed
    // flags request reads as off.
    return client.isFeatureEnabled(flag, { fresh: true }) === true
  } catch {
    return false
  }
}

// True only when the last PostHog flags request succeeded and the flag is on.
// A missing client, a flag that is not loaded or not defined, a failed flags
// request and any SDK error all read as off.
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
      unsubscribe = posthog.onFeatureFlags((_flags, _variants, context) =>
        setOn(context?.errorsLoading ? false : flagOn(posthog, flag)),
      )
    } catch {
      setOn(false)
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
