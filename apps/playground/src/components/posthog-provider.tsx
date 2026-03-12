import { PostHogProvider as PHProvider } from "posthog-js/react"
import type React from "react"
import posthog from "../lib/posthog"

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  if (!import.meta.env.VITE_POSTHOG_KEY) {
    return <>{children}</>
  }
  return <PHProvider client={posthog}>{children}</PHProvider>
}
