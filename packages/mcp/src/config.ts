/**
 * Resolve Superserve credentials for the MCP server from the environment.
 *
 * Mirrors the SDK's variables so there is no new configuration surface:
 * `SUPERSERVE_API_KEY` (required) and `SUPERSERVE_BASE_URL` (optional).
 */

/** Thrown at startup when required configuration is missing. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ConfigError"
  }
}

export interface ClientConfig {
  apiKey: string
  baseUrl?: string
}

const EXPECTED_KEY_PREFIX = "ss_live_"

/**
 * Resolve config from environment variables. Throws {@link ConfigError} when
 * `SUPERSERVE_API_KEY` is absent. A non-`ss_live_` prefix is allowed (staging
 * keys differ) but surfaced as a warning by the caller.
 */
export function resolveClientConfig(
  env: NodeJS.ProcessEnv = process.env,
): ClientConfig {
  const apiKey = env.SUPERSERVE_API_KEY?.trim()
  if (!apiKey) {
    throw new ConfigError(
      "Missing SUPERSERVE_API_KEY. Set it to your Superserve API key " +
        "(starts with `ss_live_`). Create one at https://console.superserve.ai.",
    )
  }
  const baseUrl = env.SUPERSERVE_BASE_URL?.trim() || undefined
  return { apiKey, baseUrl }
}

/** True when the key looks like a production key. Used only for a soft warning. */
export function looksLikeProdKey(apiKey: string): boolean {
  return apiKey.startsWith(EXPECTED_KEY_PREFIX)
}
