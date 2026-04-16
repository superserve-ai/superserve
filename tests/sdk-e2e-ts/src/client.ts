/**
 * Shared client factory and run-level metadata for the e2e test suite.
 *
 * All suites import `createClient()` (not construct `SuperserveClient`
 * themselves) so a single place controls auth, base URL, and defaults.
 *
 * `RUN_ID` is a short, unique string used in every resource name created
 * during this run. That makes orphaned resources easy to identify and
 * sweep if a test crashes before cleanup runs.
 */

import { SuperserveClient } from "@superserve/sdk"

const DEFAULT_BASE_URL = "https://api-staging.superserve.ai"

/** Unique per test run. Used in sandbox names + metadata tags. */
export const RUN_ID = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

/** True when credentials are available to hit a live environment. */
export function hasCredentials(): boolean {
  return Boolean(process.env.SUPERSERVE_API_KEY)
}

/**
 * Returns a `SuperserveClient` configured for the target environment.
 * Throws synchronously if `SUPERSERVE_API_KEY` is not set — callers should
 * gate on `hasCredentials()` first (via `describe.skipIf`) to skip cleanly
 * when no key is present.
 */
export function createClient(): SuperserveClient {
  const apiKey = process.env.SUPERSERVE_API_KEY
  if (!apiKey) {
    throw new Error(
      "SUPERSERVE_API_KEY is not set. Guard the suite with describe.skipIf(!hasCredentials())."
    )
  }
  const baseUrl = process.env.SUPERSERVE_BASE_URL ?? DEFAULT_BASE_URL
  return new SuperserveClient({ apiKey, baseUrl })
}
