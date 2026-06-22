/**
 * Provider catalog — built-in shortcuts for creating secrets.
 *
 * Each shortcut preconfigures the auth scheme, allowed hosts, and proxy-token
 * shape for a well-known service, so `Secret.create({ provider })` needs only a
 * name and value.
 *
 * ```typescript
 * import { Provider, Secret } from "@superserve/sdk"
 *
 * const providers = await Provider.list()
 * // → [{ name: "anthropic", display: "Anthropic", hosts: ["api.anthropic.com"], ... }, ...]
 *
 * await Secret.create({ name: "openai-prod", value: key, provider: "openai" })
 * ```
 */

import { resolveConfig } from "./config.js"
import { request } from "./http.js"
import type {
  ApiProviderShortcut,
  ConnectionOptions,
  ProviderShortcut,
} from "./types.js"
import { toProviderShortcut } from "./types.js"

// A namespace class for symmetry with Secret/Sandbox/Template; the catalog is
// read-only so there are no instances.
// oxlint-disable-next-line no-extraneous-class
export class Provider {
  /** List the built-in provider shortcuts, in catalog order. */
  static async list(
    options: ConnectionOptions = {},
  ): Promise<ProviderShortcut[]> {
    const config = resolveConfig(options)
    const raw = await request<ApiProviderShortcut[]>({
      method: "GET",
      url: `${config.baseUrl}/providers`,
      headers: { "X-API-Key": config.apiKey },
      signal: options.signal,
    })
    return raw.map(toProviderShortcut)
  }
}
