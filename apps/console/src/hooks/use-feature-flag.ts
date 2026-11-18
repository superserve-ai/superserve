"use client"

import type { PostHog } from "posthog-js"
import { usePostHog } from "posthog-js/react"
import { useEffect, useState } from "react"

// How often to look again for flag errors that PostHog records without a
// flags callback.
export const FLAG_ERROR_CHECK_MS = 10_000

function hasFlagErrors(client: PostHog): boolean {
  // PostHog lists the errors of the last flags request in this property.
  const errors: unknown = client.get_property("$feature_flag_errors")
  return Array.isArray(errors) && errors.length > 0
}

function flagOn(client: PostHog, flag: string): boolean {
  try {
    // PostHog keeps the last value of a flag that failed to evaluate.
    if (hasFlagErrors(client)) return false
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
    const cleanups: (() => void)[] = []
    const cleanUp = () => {
      for (const cleanup of cleanups) {
        try {
          cleanup()
        } catch {
          // Nothing to clean up.
        }
      }
    }
    try {
      cleanups.push(
        posthog.onFeatureFlags((_flags, _variants, context) =>
          setOn(context?.errorsLoading ? false : flagOn(posthog, flag)),
        ),
      )
      // A flags request that hits the PostHog quota records the error but
      // does not call onFeatureFlags. So the flag reads as off from the start
      // of each request until onFeatureFlags reports a good result.
      cleanups.push(posthog.on("featureFlagsReloading", () => setOn(false)))
    } catch {
      // Without both listeners the flag can not follow errors, so keep it off.
      cleanUp()
      setOn(false)
      return
    }
    setOn(flagOn(posthog, flag))
    // A follow-up request that PostHog starts on its own does not send
    // featureFlagsReloading, so also look for recorded errors on a timer.
    const timer = setInterval(() => {
      try {
        if (hasFlagErrors(posthog)) setOn(false)
      } catch {
        setOn(false)
      }
    }, FLAG_ERROR_CHECK_MS)
    return () => {
      clearInterval(timer)
      cleanUp()
    }
  }, [posthog, flag, enabled])
  return enabled && on
}
