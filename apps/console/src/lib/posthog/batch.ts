import "server-only"
import { PostHog } from "posthog-node"

/** A request-local client avoids one diagnostic batch flushing another request. */
export async function trackEventBatch(
  events: Array<{
    event: string
    distinctId: string
    properties: Record<string, unknown>
  }>,
) {
  const apiKey = process.env.NEXT_PUBLIC_POSTHOG_KEY
  if (!apiKey || !events.length) return
  const client = new PostHog(apiKey, {
    host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
    flushAt: 20,
    flushInterval: 0,
    requestTimeout: 1500,
    fetchRetryCount: 0,
  })
  try {
    for (const event of events.slice(0, 12)) client.capture(event)
    await client.shutdown()
  } catch {
    /* Diagnostic delivery is best effort. */
  }
}
