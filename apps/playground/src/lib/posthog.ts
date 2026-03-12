import posthog from "posthog-js"

const apiKey = import.meta.env.VITE_POSTHOG_KEY as string | undefined
const host =
  (import.meta.env.VITE_POSTHOG_HOST as string) || "https://us.i.posthog.com"

if (apiKey) {
  try {
    posthog.init(apiKey, {
      api_host: host,
      person_profiles: "always",
      capture_pageview: false,
      capture_pageleave: true,
      cross_subdomain_cookie: true,
      session_recording: {
        maskAllInputs: true,
        maskTextSelector: "[data-mask]",
      },
    })
  } catch (error) {
    console.warn("PostHog failed to initialize:", error)
  }
}

export default posthog
