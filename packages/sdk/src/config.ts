/**
 * Connection configuration for the Superserve SDK.
 *
 * Resolves API key and base URLs from explicit options or environment
 * variables. Constructs the data-plane URL for per-sandbox file operations.
 */

import { AuthenticationError, ValidationError } from "./errors.js"

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

// Sandbox hosts where the proxy supports shared-host routing.
const SUPPORTED_SHARED_HOSTS: ReadonlySet<string> = new Set([
  "sandbox.superserve.ai",
  "staging-sandbox.superserve.ai",
])

const SANDBOX_ID_HEADER = "X-Superserve-Sandbox-Id"

/** Base URL + routing headers for one data-plane request. */
export interface DataPlaneTarget {
  url: string
  headers: Record<string, string>
}

/**
 * Resolve the data-plane base URL + routing headers for a sandbox.
 *
 * On a supported host (server-side), routes via the shared origin with
 * `X-Superserve-Sandbox-Id`. Browsers and unsupported hosts use the
 * per-sandbox subdomain.
 */
export function dataPlaneTarget(
  sandboxId: string,
  sandboxHost: string,
): DataPlaneTarget {
  const isBrowser = typeof window !== "undefined"
  const host = sandboxHost.toLowerCase()
  if (!isBrowser && SUPPORTED_SHARED_HOSTS.has(host)) {
    return {
      url: `https://${host}`,
      headers: { [SANDBOX_ID_HEADER]: sandboxId },
    }
  }
  return {
    url: `https://boxd-${sandboxId}.${host}`,
    headers: {},
  }
}

/**
 * Lowest / highest TCP port a preview URL can target. Privileged ports
 * (< 1024) are refused by the edge proxy, so we reject them up front.
 *
 * Mirrored by the console (apps/console/src/hooks/use-preview-ports.ts) and the
 * Python SDK; keep all three in sync. Tests pin the literals on each side so
 * one-sided drift fails CI.
 */
export const MIN_PREVIEW_PORT = 1024
export const MAX_PREVIEW_PORT = 65535

/**
 * Build the public preview URL for a port running inside a sandbox.
 *
 * The edge proxy routes `https://{port}-{id}.{host}` straight to that port
 * on the VM, so this is pure string construction — no network call. The
 * sandbox must be running and a server must be listening on `port` for the
 * URL to resolve.
 *
 * Always uses the per-sandbox subdomain form (never the shared-host mode):
 * a browser opening the URL can't send the `X-Superserve-Sandbox-Id` header.
 *
 * @throws {ValidationError} if `port` is not an integer in [1024, 65535].
 */
export function previewUrl(
  sandboxId: string,
  sandboxHost: string,
  port: number,
): string {
  if (
    !Number.isInteger(port) ||
    port < MIN_PREVIEW_PORT ||
    port > MAX_PREVIEW_PORT
  ) {
    throw new ValidationError(
      `Invalid preview port ${port}: must be an integer between ${MIN_PREVIEW_PORT} and ${MAX_PREVIEW_PORT}. Privileged ports (< ${MIN_PREVIEW_PORT}) are not proxied.`,
    )
  }
  return `https://${port}-${sandboxId}.${sandboxHost}`
}

/**
 * Derive the data-plane sandbox host from the control-plane base URL.
 *
 * `https://api.superserve.ai`         → `sandbox.superserve.ai`
 * `https://api-staging.superserve.ai` → `staging-sandbox.superserve.ai`
 * Any other URL                        → `sandbox.superserve.ai` (safe default)
 */
function deriveSandboxHost(baseUrl: string): string {
  try {
    const url = new URL(baseUrl)
    const host = url.hostname
    if (host === "api-staging.superserve.ai") {
      return "staging-sandbox.superserve.ai"
    }
    if (host === "api.superserve.ai") {
      return "sandbox.superserve.ai"
    }
  } catch {
    // Invalid URL — use default
  }
  return DEFAULT_SANDBOX_HOST
}
