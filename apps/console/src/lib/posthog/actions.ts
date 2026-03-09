"use server"

import { PostHog } from "posthog-node"

const apiKey = process.env.NEXT_PUBLIC_POSTHOG_KEY
const host = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com"

let posthogClient: PostHog | null = null

function getPostHogClient(): PostHog | null {
  if (!apiKey) return null
  if (!posthogClient) {
    posthogClient = new PostHog(apiKey, {
      host,
      flushAt: 1,
      flushInterval: 0,
    })
  }
  return posthogClient
}

export async function trackEvent(
  event: string,
  distinctId: string,
  // biome-ignore lint/suspicious/noExplicitAny: PostHog properties type
  properties?: Record<string, any>,
) {
  const client = getPostHogClient()
  if (!client) {
    console.warn("PostHog not configured, skipping event tracking")
    return
  }

  try {
    client.capture({
      distinctId,
      event,
      properties: properties || {},
    })
    await client.flush()
  } catch (error) {
    console.error("Failed to track event:", error)
  }
}
