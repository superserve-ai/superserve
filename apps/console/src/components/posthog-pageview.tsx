"use client"

import { usePathname, useSearchParams } from "next/navigation"
import { useEffect } from "react"

import {
  redactInviteTokens,
  syncRecordingWithAddress,
} from "@/lib/invite-token-redaction"

export function PostHogPageView() {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  useEffect(() => {
    if (pathname && typeof window !== "undefined") {
      import("posthog-js")
        .then((posthogModule) => {
          const posthog = posthogModule.default
          if (posthog.__loaded) {
            syncRecordingWithAddress(posthog, window.location.href)
            let url = window.origin + redactInviteTokens(pathname)
            if (searchParams?.toString()) {
              url = `${url}?${redactInviteTokens(searchParams.toString())}`
            }
            posthog.capture("$pageview", {
              $current_url: url,
              $pathname: redactInviteTokens(pathname),
            })
          }
        })
        .catch(() => {})
    }
  }, [pathname, searchParams])

  return null
}
