import {
  knownSandboxHost,
  resolveConfig,
  type ResolvedConfig,
} from "./config.js"
import { ValidationError } from "./errors.js"
import type { ConnectionOptions } from "./types.js"

export type ResolvedSandboxConfig =
  | ResolvedConfig
  | {
      machineCredential: string
      apiKey?: never
      baseUrl: string
      sandboxHost: string
    }

export function resolveSandboxConfig(
  options: ConnectionOptions = {},
): ResolvedSandboxConfig {
  if (options.machineCredential === undefined) return resolveConfig(options)
  if (options.apiKey !== undefined) {
    throw new ValidationError(
      "Pass either machineCredential or apiKey, never both",
    )
  }
  const credential = options.machineCredential
  if (
    typeof credential !== "string" ||
    !credential ||
    /[^\x21-\x7e]/.test(credential)
  ) {
    throw new ValidationError(
      "machineCredential must be a nonempty printable credential without whitespace",
    )
  }
  let endpoint: URL
  try {
    endpoint = new URL(options.baseUrl ?? "")
  } catch {
    throw new ValidationError(
      "Machine credentials require an explicit baseUrl origin",
    )
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname)
  if (
    (endpoint.protocol !== "https:" &&
      !(local && endpoint.protocol === "http:")) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    endpoint.pathname !== "/"
  ) {
    throw new ValidationError(
      "Machine baseUrl must be an HTTPS origin (HTTP is allowed only on loopback)",
    )
  }
  const sandboxHost = options.sandboxHost ?? knownSandboxHost(endpoint.origin)
  if (sandboxHost === undefined) {
    throw new ValidationError(
      "Custom machine baseUrl requires an explicit sandboxHost",
    )
  }
  // Reserve a full 63-character sandbox label plus its dot within the 253-character DNS limit.
  // This is a DNS suffix used in HTTPS and per-sandbox WebSocket hosts, not a URL.
  if (
    typeof sandboxHost !== "string" ||
    !/^(?=.{1,189}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(
      sandboxHost,
    )
  ) {
    throw new ValidationError(
      "sandboxHost must be a lowercase DNS hostname of at most 189 characters without a scheme, port or path",
    )
  }
  try {
    // Numeric/IP suffixes pass DNS-label syntax but cannot form a prefixed URL host.
    const prefixedHost = `boxd-validation.${sandboxHost}`
    if (new URL(`https://${prefixedHost}`).hostname !== prefixedHost) {
      throw new Error("Invalid host")
    }
  } catch {
    throw new ValidationError(
      "sandboxHost must support per-sandbox DNS names, not an IP address",
    )
  }
  return {
    machineCredential: credential,
    baseUrl: endpoint.origin,
    sandboxHost,
  }
}

export function requireApiKeyConfig(
  config: ResolvedSandboxConfig,
): ResolvedConfig {
  if (config.machineCredential !== undefined) {
    throw new ValidationError(
      "This operation does not support machine credentials",
    )
  }
  return config
}

/** Central allowlist: adding a Sandbox method must not expand root authority. */
export function controlPlaneHeaders(
  config: ResolvedSandboxConfig,
  method: string,
  url: string,
): Record<string, string> {
  if (config.machineCredential === undefined)
    return { "X-API-Key": config.apiKey }
  const prefix = `${config.baseUrl}/`
  const path = url.startsWith(prefix) ? url.slice(prefix.length) : ""
  const collection =
    /^sandboxes(?:\?[^#]*)?$/.test(path) &&
    (method === "GET" || (method === "POST" && path === "sandboxes"))
  const resource =
    /^sandboxes\/[A-Za-z0-9_-]+$/.test(path) &&
    ["GET", "PATCH", "DELETE"].includes(method)
  const lifecycle =
    /^sandboxes\/[A-Za-z0-9_-]+\/(pause|resume|activate)$/.test(path) &&
    method === "POST"
  if (!collection && !resource && !lifecycle) {
    throw new ValidationError("This route does not support machine credentials")
  }
  return { "X-QM-Machine-Credential": config.machineCredential }
}
