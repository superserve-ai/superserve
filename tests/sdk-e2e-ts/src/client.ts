/**
 * Shared test helpers for the e2e test suite.
 */

import type { ConnectionOptions } from "@superserve/sdk"

const DEFAULT_BASE_URL = "https://api-staging.superserve.ai"

/** Unique per test run. Used in sandbox names + metadata tags. */
export const RUN_ID = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

/** True when credentials are available to hit a live environment. */
export function hasCredentials(): boolean {
  return Boolean(process.env.SUPERSERVE_API_KEY)
}

/** Connection options for all SDK calls. */
export function connectionOptions(): ConnectionOptions {
  const apiKey = process.env.SUPERSERVE_API_KEY
  if (!apiKey) {
    throw new Error(
      "SUPERSERVE_API_KEY is not set. Guard the suite with describe.skipIf(!hasCredentials()).",
    )
  }
  const baseUrl = process.env.SUPERSERVE_BASE_URL ?? DEFAULT_BASE_URL
  return { apiKey, baseUrl }
}
