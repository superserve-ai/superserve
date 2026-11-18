"use client"

import type { PostHog } from "posthog-js"
import { usePostHog } from "posthog-js/react"
import { useCallback, useEffect, useState, useSyncExternalStore } from "react"

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

export interface FlagRequests {
  // A flags request started and has not reported a result yet.
  pending: boolean
  // The last flags request failed.
  failed: boolean
  // The PostHog listeners could not be set up.
  broken: boolean
  // The number of flags results so far.
  loads: number
}

const IDLE: FlagRequests = {
  pending: false,
  failed: false,
  broken: false,
  loads: 0,
}
const BROKEN: FlagRequests = { ...IDLE, broken: true }

interface Tracker {
  state: FlagRequests
  listeners: Set<() => void>
}

const trackers = new WeakMap<PostHog, Tracker>()

// Follows the flags requests of a PostHog client for the life of the page.
// Call it right after init: a listener added during a request gets the old
// flags at once and can not tell them from a result.
export function trackFlagRequests(client: PostHog): Tracker {
  const known = trackers.get(client)
  if (known) return known
  const tracker: Tracker = { state: IDLE, listeners: new Set() }
  trackers.set(client, tracker)
  const update = (next: Partial<FlagRequests>) => {
    if (tracker.state.broken) return
    tracker.state = { ...tracker.state, ...next }
    for (const listener of tracker.listeners) listener()
  }
  try {
    // A flags request that hits the PostHog quota records the error but does
    // not call onFeatureFlags. So the flag reads as off from the start of each
    // request until onFeatureFlags reports a result.
    client.on("featureFlagsReloading", () => {
      if (!tracker.state.pending) update({ pending: true })
    })
    client.onFeatureFlags((_flags, _variants, context) =>
      update({
        pending: false,
        failed: context?.errorsLoading === true,
        loads: tracker.state.loads + 1,
      }),
    )
  } catch {
    // Without both listeners the flag can not follow errors, so keep it off.
    tracker.state = BROKEN
  }
  return tracker
}

// True only when the last PostHog flags request succeeded and the flag is on.
// A missing client, a flag that is not loaded or not defined, a failed flags
// request, a flags request that has not finished and any SDK error all read
// as off.
// The flag is read only while `enabled`, so PostHog records an exposure only
// for users the flag can change.
export function useFeatureFlagOn(flag: string, enabled = true): boolean {
  const posthog = usePostHog() as PostHog | undefined
  const subscribe = useCallback(
    (notify: () => void) => {
      if (!posthog) return () => {}
      const { listeners } = trackFlagRequests(posthog)
      listeners.add(notify)
      return () => {
        listeners.delete(notify)
      }
    },
    [posthog],
  )
  const requests = useSyncExternalStore(
    subscribe,
    () => (posthog ? trackFlagRequests(posthog).state : IDLE),
    () => IDLE,
  )
  const [on, setOn] = useState(false)

  const blocked = requests.pending || requests.failed || requests.broken
  const { loads } = requests
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
  }, [posthog, flag, enabled, blocked, loads])

  return enabled && !blocked && on
}
