"use client"

import posthog from "posthog-js"
import { PostHogProvider as PHProvider } from "posthog-js/react"
import type React from "react"

import {
  carriesInviteToken,
  redactCapturedRequest,
  redactInviteTokens,
  redactInviteTokensFromEvent,
  scrubPersistedInviteTokens,
  syncRecordingWithAddress,
} from "@/lib/invite-token-redaction"

if (typeof window !== "undefined") {
  const apiKey = process.env.NEXT_PUBLIC_POSTHOG_KEY

  if (apiKey) {
    try {
      posthog.init(apiKey, {
        api_host: "/ingest",
        ui_host: "https://us.posthog.com",
        person_profiles: "always",
        capture_pageview: false,
        capture_pageleave: true,
        cross_subdomain_cookie: true,
        // A recorder script that starts loading during init does not recheck
        // a later stop when it lands, so a token address starts disabled;
        // `loaded` records the pause and the next plain address resumes it.
        disable_session_recording: carriesInviteToken(window.location.href),
        // Invitation tokens never leave the browser: this is the final scrub
        // of every event, whatever put the token there.
        before_send: (event) => {
          scrubPersistedInviteTokens(posthog)
          return redactInviteTokensFromEvent(event)
        },
        loaded: (ph) => {
          scrubPersistedInviteTokens(ph)
          syncRecordingWithAddress(ph, window.location.href)
        },
        session_recording: {
          maskAllInputs: true,
          maskTextSelector: "[data-mask]",
          recordHeaders: false,
          recordBody: false,
          maskCapturedNetworkRequestFn: redactCapturedRequest,
        },
      })
      // First-touch attribution: if the user landed directly on the console
      // (e.g. shared signup link with UTMs), remember the first path, the
      // referrer, and any UTM params so funnel events carry them as super
      // properties. register_once never overwrites an existing value.
      const url = new URL(window.location.href)
      const utm: Record<string, string> = {}
      for (const key of [
        "utm_source",
        "utm_medium",
        "utm_campaign",
        "utm_term",
        "utm_content",
      ]) {
        const value = url.searchParams.get(key)
        if (value) utm[`first_${key}`] = value
      }
      posthog.register_once({
        first_landing_path: redactInviteTokens(url.pathname),
        first_referrer: redactInviteTokens(document.referrer) || "(direct)",
        ...utm,
      })
    } catch (error) {
      console.warn("PostHog failed to initialize:", error)
    }
  }
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) {
    return <>{children}</>
  }
  return <PHProvider client={posthog}>{children}</PHProvider>
}
