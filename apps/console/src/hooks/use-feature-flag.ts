"use client"

import type { PostHog } from "posthog-js"
import { usePostHog } from "posthog-js/react"
import { useCallback, useEffect, useState, useSyncExternalStore } from "react"

// How often to look again for flag errors that PostHog records without a
// flags callback.
export const FLAG_ERROR_CHECK_MS = 10_000
// PostHog stops a flags request after `feature_flag_request_timeout_ms`
// (3 s by default), so a request is over after this long.
export const FLAG_REQUEST_LIMIT_MS = 10_000

// PostHog lists the errors of the last flags request in this property.
function flagErrors(client: Pick<PostHog, "get_property">): unknown {
  return client.get_property("$feature_flag_errors")
}

function hasFlagErrors(client: PostHog): boolean {
  const errors = flagErrors(client)
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

type FlagClient = Pick<PostHog, "on" | "onFeatureFlags" | "get_property">

const trackers = new WeakMap<FlagClient, Tracker>()

// Follows the flags requests of a PostHog client for the life of the page.
// Call it from the PostHog `loaded` callback, before the first request: a
// request that started earlier is not seen.
export function trackFlagRequests(client: FlagClient): Tracker {
  const known = trackers.get(client)
  if (known) return known
  const tracker: Tracker = { state: IDLE, listeners: new Set() }
  trackers.set(client, tracker)
  const update = (next: Partial<FlagRequests>) => {
    if (tracker.state.broken) return
    tracker.state = { ...tracker.state, ...next }
    for (const listener of tracker.listeners) listener()
  }
  // PostHog sends one flags request at a time. A reload during a request
  // waits, and PostHog sends it after the next result without a new
  // featureFlagsReloading event. A request that ends with a quota error keeps
  // the waiting reload for the request after it.
  let waiting = false
  // When the request now followed started, and the flag errors then.
  // PostHog stores a new errors list at the end of every request, also for a
  // request that hits the quota and sends no result. A request can also end
  // without either, so after FLAG_REQUEST_LIMIT_MS a reload starts a new one.
  let startedAt = 0
  let errorsAtStart: unknown
  const errorsNow = () => {
    try {
      return flagErrors(client)
    } catch {
      // Then only the time limit ends a request.
      return undefined
    }
  }
  const start = () => {
    startedAt = Date.now()
    errorsAtStart = errorsNow()
  }
  try {
    // A flags request that hits the PostHog quota records the error but does
    // not call onFeatureFlags. So the flag reads as off from the start of each
    // request until onFeatureFlags reports a result.
    client.on("featureFlagsReloading", () => {
      if (
        tracker.state.pending &&
        Date.now() - startedAt < FLAG_REQUEST_LIMIT_MS &&
        errorsNow() === errorsAtStart
      ) {
        waiting = true
        return
      }
      start()
      if (!tracker.state.pending) update({ pending: true })
    })
    client.onFeatureFlags((_flags, _variants, context) => {
      // Only the result of a flags request has `errorsLoading`. Other calls,
      // such as the call that replays the last flags to a new listener, do
      // not end a request.
      if (typeof context?.errorsLoading !== "boolean") {
        update({ loads: tracker.state.loads + 1 })
        return
      }
      const pending = waiting
      waiting = false
      start()
      update({
        pending,
        failed: context.errorsLoading,
        loads: tracker.state.loads + 1,
      })
    })
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
