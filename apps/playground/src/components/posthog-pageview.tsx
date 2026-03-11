import { useEffect, useRef } from "react"
import posthog from "../lib/posthog"

export function PostHogPageView() {
  const lastPath = useRef<string | undefined>(undefined)

  useEffect(() => {
    const currentPath = window.location.pathname + window.location.search
    if (currentPath !== lastPath.current && posthog.__loaded) {
      lastPath.current = currentPath
      posthog.capture("$pageview", { $current_url: window.location.href })
    }
  })

  return null
}
