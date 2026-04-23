/**
 * Connection configuration for the Superserve SDK.
 *
 * Resolves API key and base URLs from explicit options or environment
 * variables. Constructs the data-plane URL for per-sandbox file operations.
 */

import { AuthenticationError } from "./errors.js"

const DEFAULT_BASE_URL = "https://api.superserve.ai"
const DEFAULT_SANDBOX_HOST = "sandbox.superserve.ai"

export interface ResolvedConfig {
  apiKey: string
  baseUrl: string
  sandboxHost: string
}

/**
 * Resolve connection config from explicit options + environment variables.
 *
 * Priority: explicit option > SUPERSERVE_API_KEY / SUPERSERVE_BASE_URL env vars.
 * Throws if no API key can be resolved.
 */
export function resolveConfig(opts?: {
  apiKey?: string
  baseUrl?: string
}): ResolvedConfig {
  const apiKey = opts?.apiKey ?? process.env.SUPERSERVE_API_KEY
  if (!apiKey) {
    throw new AuthenticationError(
      "Missing API key. Pass `apiKey` or set the SUPERSERVE_API_KEY environment variable.",
    )
  }
  const baseUrl =
    opts?.baseUrl ?? process.env.SUPERSERVE_BASE_URL ?? DEFAULT_BASE_URL
  const sandboxHost = deriveSandboxHost(baseUrl)
  return { apiKey, baseUrl, sandboxHost }
}

/**
 * Build the data-plane base URL for a specific sandbox.
 *
 * Example: `https://boxd-{sandboxId}.sandbox.superserve.ai`
 */
export function dataPlaneUrl(sandboxId: string, sandboxHost: string): string {
  return `https://boxd-${sandboxId}.${sandboxHost}`
}

/**
 * Derive the data-plane sandbox host from the control-plane base URL.
 *
 * `https://api.superserve.ai`         → `sandbox.superserve.ai`
 * `https://api-staging.superserve.ai` → `sandbox-staging.superserve.ai`
 * Any other URL                        → `sandbox.superserve.ai` (safe default)
 */
function deriveSandboxHost(baseUrl: string): string {
  try {
    const url = new URL(baseUrl)
    const host = url.hostname
    if (host === "api-staging.superserve.ai") {
      return "sandbox-staging.superserve.ai"
    }
    if (host === "api.superserve.ai") {
      return "sandbox.superserve.ai"
    }
  } catch {
    // Invalid URL — use default
  }
  return DEFAULT_SANDBOX_HOST
}
