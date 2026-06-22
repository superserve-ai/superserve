/**
 * Secret class — a team-stored credential that the platform injects at egress.
 *
 * The real value never enters a sandbox. The agent sees a proxy token under an
 * environment variable; the in-host daemon swaps it for the real credential on
 * outbound requests to the secret's allowed hosts.
 *
 * ```typescript
 * import { Secret, Sandbox } from "@superserve/sdk"
 *
 * // Built-in provider shortcut — auth + hosts are preconfigured.
 * await Secret.create({
 *   name: "anthropic-prod",
 *   value: process.env.ANTHROPIC_API_KEY!,
 *   provider: "anthropic",
 * })
 *
 * // Bind it to a sandbox under an env var the agent reads.
 * const sandbox = await Sandbox.create({
 *   name: "agent-1",
 *   secrets: { ANTHROPIC_API_KEY: "anthropic-prod" },
 * })
 * ```
 */

import { type ResolvedConfig, resolveConfig } from "./config.js"
import { NotFoundError } from "./errors.js"
import { request, requestVoid } from "./http.js"
import type {
  ApiProxyAuditEvent,
  ApiSecretResponse,
  ApiSecretSandbox,
  ConnectionOptions,
  ProxyAuditEvent,
  SecretAuditOptions,
  SecretAuthType,
  SecretCreateOptions,
  SecretInfo,
  SecretListOptions,
  SecretSandboxBinding,
} from "./types.js"
import {
  secretCreateBody,
  toProxyAuditEvent,
  toSecretInfo,
  toSecretSandboxBinding,
} from "./types.js"

export class Secret {
  readonly id: string
  readonly name: string
  readonly authType: SecretAuthType
  readonly authConfig: Record<string, unknown>
  readonly providerShortcut?: string
  readonly hosts: string[]
  readonly createdAt: Date
  readonly updatedAt: Date
  readonly lastUsedAt?: Date

  private readonly _config: ResolvedConfig

  /** @internal — use `Secret.create()` / `Secret.get()` instead. */
  private constructor(info: SecretInfo, config: ResolvedConfig) {
    this.id = info.id
    this.name = info.name
    this.authType = info.authType
    this.authConfig = info.authConfig
    this.providerShortcut = info.providerShortcut
    this.hosts = info.hosts
    this.createdAt = info.createdAt
    this.updatedAt = info.updatedAt
    this.lastUsedAt = info.lastUsedAt
    this._config = config
  }

  // -------------------------------------------------------------------------
  // Static factories
  // -------------------------------------------------------------------------

  /**
   * Create a secret. Provide either a `provider` shortcut, or a custom `auth`
   * config together with `hosts`.
   */
  static async create(options: SecretCreateOptions): Promise<Secret> {
    const config = resolveConfig(options)
    const raw = await request<ApiSecretResponse>({
      method: "POST",
      url: `${config.baseUrl}/secrets`,
      headers: { "X-API-Key": config.apiKey },
      body: secretCreateBody(options),
      signal: options.signal,
    })
    return new Secret(toSecretInfo(raw), config)
  }

  /** Fetch an existing secret by name. */
  static async get(
    name: string,
    options: ConnectionOptions = {},
  ): Promise<Secret> {
    const config = resolveConfig(options)
    const raw = await request<ApiSecretResponse>({
      method: "GET",
      url: `${config.baseUrl}/secrets/${encodeURIComponent(name)}`,
      headers: { "X-API-Key": config.apiKey },
      signal: options.signal,
    })
    return new Secret(toSecretInfo(raw), config)
  }

  /** List all secrets for the team. */
  static async list(options: SecretListOptions = {}): Promise<SecretInfo[]> {
    const config = resolveConfig(options)
    const raw = await request<ApiSecretResponse[]>({
      method: "GET",
      url: `${config.baseUrl}/secrets`,
      headers: { "X-API-Key": config.apiKey },
      signal: options.signal,
    })
    return raw.map(toSecretInfo)
  }

  /** Delete a secret by name. Idempotent — no error if it's already gone. */
  static async deleteByName(
    name: string,
    options: ConnectionOptions = {},
  ): Promise<void> {
    const config = resolveConfig(options)
    try {
      await requestVoid({
        method: "DELETE",
        url: `${config.baseUrl}/secrets/${encodeURIComponent(name)}`,
        headers: { "X-API-Key": config.apiKey },
        signal: options.signal,
      })
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err
    }
  }

  // -------------------------------------------------------------------------
  // Instance methods
  // -------------------------------------------------------------------------

  /** Re-fetch the latest metadata for this secret. */
  async getInfo(): Promise<SecretInfo> {
    const raw = await request<ApiSecretResponse>({
      method: "GET",
      url: `${this._config.baseUrl}/secrets/${encodeURIComponent(this.name)}`,
      headers: { "X-API-Key": this._config.apiKey },
    })
    return toSecretInfo(raw)
  }

  /**
   * Replace the secret's value (rotation). Bound sandboxes keep their env var;
   * the new value is injected on subsequent egress. Returns the updated secret.
   */
  async rotate(value: string): Promise<Secret> {
    const raw = await request<ApiSecretResponse>({
      method: "PATCH",
      url: `${this._config.baseUrl}/secrets/${encodeURIComponent(this.name)}`,
      headers: { "X-API-Key": this._config.apiKey },
      body: { value },
    })
    return new Secret(toSecretInfo(raw), this._config)
  }

  /** Delete this secret. Idempotent. */
  async delete(): Promise<void> {
    try {
      await requestVoid({
        method: "DELETE",
        url: `${this._config.baseUrl}/secrets/${encodeURIComponent(this.name)}`,
        headers: { "X-API-Key": this._config.apiKey },
      })
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err
    }
  }

  /** Requests made with this secret attached, across all sandboxes, newest first. */
  async getAudit(options: SecretAuditOptions = {}): Promise<ProxyAuditEvent[]> {
    const qs = new URLSearchParams()
    if (options.limit !== undefined) qs.set("limit", String(options.limit))
    if (options.before !== undefined) qs.set("before", String(options.before))
    if (options.status) qs.set("status", options.status)
    const suffix = qs.toString() ? `?${qs.toString()}` : ""

    const raw = await request<ApiProxyAuditEvent[]>({
      method: "GET",
      url: `${this._config.baseUrl}/secrets/${encodeURIComponent(this.name)}/audit${suffix}`,
      headers: { "X-API-Key": this._config.apiKey },
      signal: options.signal,
    })
    return raw.map(toProxyAuditEvent)
  }

  /** Sandboxes this secret is currently bound to. */
  async getSandboxes(): Promise<SecretSandboxBinding[]> {
    const raw = await request<ApiSecretSandbox[]>({
      method: "GET",
      url: `${this._config.baseUrl}/secrets/${encodeURIComponent(this.name)}/sandboxes`,
      headers: { "X-API-Key": this._config.apiKey },
    })
    return raw.map(toSecretSandboxBinding)
  }
}
