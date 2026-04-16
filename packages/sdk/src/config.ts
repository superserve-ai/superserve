/**
 * Connection configuration for the Superserve SDK.
 *
 * Resolves API key and base URLs from explicit options or environment
 * variables. Constructs the data-plane URL for per-sandbox file operations.
 */

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
    throw new Error(
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
 * Derive the sandbox host from the control-plane base URL.
 *
 * `https://api.superserve.ai`         → `sandbox.superserve.ai`
 * `https://api-staging.superserve.ai`  → `sandbox.superserve.ai`
 * `http://localhost:8080`              → `sandbox.superserve.ai` (fallback)
 */
function deriveSandboxHost(baseUrl: string): string {
  try {
    const url = new URL(baseUrl)
    if (url.hostname.endsWith("superserve.ai")) {
      return DEFAULT_SANDBOX_HOST
    }
  } catch {
    // Invalid URL — use default
  }
  return DEFAULT_SANDBOX_HOST
}
