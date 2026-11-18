import type { PostHog } from "posthog-js"

/**
 * Records an event without letting an analytics failure change the caller's
 * flow. `posthog.capture` can throw (for example from a `before_send` hook),
 * and auth error paths must still show their own message when it does.
 */
export function captureBestEffort(
  posthog: PostHog,
  event: string,
  properties?: Record<string, unknown>,
) {
  try {
    posthog.capture(event, properties)
  } catch {
    // Analytics is best-effort here.
  }
}
