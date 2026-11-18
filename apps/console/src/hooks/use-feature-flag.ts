"use client"

import type { PostHog } from "posthog-js"
import { usePostHog } from "posthog-js/react"
import { useEffect, useRef, useState } from "react"

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

interface FlagsState {
  // A flags request started and has not reported a result yet.
  pending: boolean
  // The last flags request failed.
  failed: boolean
  // The PostHog listeners could not be set up.
  broken: boolean
}

// True only when the last PostHog flags request succeeded and the flag is on.
// A missing client, a flag that is not loaded or not defined, a failed flags
// request, a flags request that has not finished and any SDK error all read
// as off.
// The flag is read only while `enabled`, so PostHog records an exposure only
// for users the flag can change. Flags requests are followed all the time, so
// a request that started before `enabled` still keeps the flag off.
export function useFeatureFlagOn(flag: string, enabled = true): boolean {
  const posthog = usePostHog() as PostHog | undefined
  const [flags, setFlags] = useState<FlagsState>({
    pending: false,
    failed: false,
    broken: false,
  })
  const [on, setOn] = useState(false)
  // The listeners below read these without subscribing again.
  const read = useRef({ flag, enabled })
  useEffect(() => {
    read.current = { flag, enabled }
  })

  useEffect(() => {
    if (!posthog) return
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
      // A flags request that hits the PostHog quota records the error but
      // does not call onFeatureFlags. So the flag reads as off from the start
      // of each request until onFeatureFlags reports a result.
      cleanups.push(
        posthog.on("featureFlagsReloading", () =>
          setFlags((current) =>
            current.pending ? current : { ...current, pending: true },
          ),
        ),
      )
      cleanups.push(
        posthog.onFeatureFlags((_flags, _variants, context) => {
          const failed = context?.errorsLoading === true
          setFlags((current) =>
            !current.pending && current.failed === failed
              ? current
              : { ...current, pending: false, failed },
          )
          if (read.current.enabled && !failed)
            setOn(flagOn(posthog, read.current.flag))
        }),
      )
      setFlags((current) =>
        current.broken ? { ...current, broken: false } : current,
      )
    } catch {
      // Without both listeners the flag can not follow errors, so keep it off.
      cleanUp()
      setFlags((current) =>
        current.broken ? current : { ...current, broken: true },
      )
      return
    }
    return cleanUp
  }, [posthog])

  const blocked = flags.pending || flags.failed || flags.broken
  useEffect(() => {
    if (!enabled || !posthog || blocked) {
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
    return () => clearInterval(timer)
  }, [posthog, flag, enabled, blocked])

  return enabled && !blocked && on
}
