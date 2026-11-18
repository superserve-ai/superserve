import "server-only"

// Server-only settings. `HEEDEO_SECRET_KEY` must never reach the browser.

/** The workspace's secret key (`sk_...`), or undefined when unset. */
export function heedeoSecretKey(): string | undefined {
  const value = process.env.HEEDEO_SECRET_KEY?.trim()
  return value ? value : undefined
}

/**
 * True when the observation runs: a secret key is set and the kill switch
 * `HEEDEO_SIGNUP_OBSERVATION=off` is not. With it off, the first-party route
 * answers 404, so the script does not load and no identification is billed,
 * and the server sends no event.
 */
export function heedeoObservationEnabled(): boolean {
  return (
    process.env.HEEDEO_SIGNUP_OBSERVATION?.trim().toLowerCase() !== "off" &&
    heedeoSecretKey() !== undefined
  )
}
