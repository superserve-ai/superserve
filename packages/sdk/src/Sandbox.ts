/**
 * Main Sandbox class — the primary entry point for the Superserve SDK.
 *
 * Uses the E2B pattern: static factory methods (create/connect), sub-modules
 * as properties (.commands, .files), dual static/instance lifecycle methods.
 *
 * ```typescript
 * import { Sandbox } from "@superserve/sdk"
 *
 * const sandbox = await Sandbox.create({ name: "my-sandbox" })
 * const result = await sandbox.commands.run("echo hello")
 * await sandbox.files.write("/app/data.txt", "content")
 * await sandbox.kill()
 * ```
 */

import { Commands } from "./commands.js"
import { type ResolvedConfig, resolveConfig } from "./config.js"
import { NotFoundError, SandboxError } from "./errors.js"
import { Files } from "./files.js"
import { request, requestVoid } from "./http.js"
import { waitForStatus } from "./polling.js"
import type {
  ApiSandboxResponse,
  ConnectionOptions,
  SandboxCreateOptions,
  SandboxInfo,
  SandboxListOptions,
  SandboxStatus,
  SandboxUpdateOptions,
  SandboxWaitOptions,
} from "./types.js"
import { toSandboxInfo } from "./types.js"

export class Sandbox {
  /** Unique sandbox ID (UUID). */
  readonly id: string

  /** Human-readable sandbox name. */
  readonly name: string

  /** Sandbox status at construction time. Call getInfo() for the current status. */
  readonly status: SandboxStatus

  /** User-supplied metadata tags at construction time. Call getInfo() to refresh. */
  readonly metadata: Record<string, string>

  /**
   * Per-sandbox access token for data-plane operations.
   * Used internally by the Files sub-module. Exposed for advanced use cases.
   */
  readonly accessToken: string

  /** Execute shell commands inside this sandbox. */
  readonly commands: Commands

  /** Upload and download files to/from this sandbox. */
  readonly files: Files

  private readonly _config: ResolvedConfig

  /** @internal — Use Sandbox.create() or Sandbox.connect() instead. */
  private constructor(info: SandboxInfo, config: ResolvedConfig) {
    if (!info.accessToken) {
      throw new SandboxError(
        "Invalid API response: missing access_token (required for a live Sandbox instance)",
      )
    }
    this.id = info.id
    this.name = info.name
    this.status = info.status
    this.metadata = info.metadata
    this.accessToken = info.accessToken
    this._config = config

    this.commands = new Commands(config.baseUrl, this.id, config.apiKey)
    this.files = new Files(this.id, config.sandboxHost, this.accessToken)
  }

  // -------------------------------------------------------------------------
  // Static factory methods
  // -------------------------------------------------------------------------

  /**
   * Create a new sandbox and return a connected Sandbox instance.
   *
   * Returns immediately after the API confirms creation (status may be
   * `starting`). Call `await sandbox.waitForReady()` to block until `active`.
   *
   * @example
   * ```typescript
   * const sandbox = await Sandbox.create({ name: "my-sandbox" })
   * await sandbox.waitForReady()
   * ```
   */
  static async create(options: SandboxCreateOptions): Promise<Sandbox> {
    const config = resolveConfig(options)

    const body: Record<string, unknown> = { name: options.name }
    if (options.fromSnapshot !== undefined)
      body.from_snapshot = options.fromSnapshot
    if (options.timeoutSeconds !== undefined)
      body.timeout_seconds = options.timeoutSeconds
    if (options.metadata !== undefined) body.metadata = options.metadata
    if (options.envVars !== undefined) body.env_vars = options.envVars
    if (options.network) {
      body.network = {
        allow_out: options.network.allowOut,
        deny_out: options.network.denyOut,
      }
    }

    const raw = await request<ApiSandboxResponse>({
      method: "POST",
      url: `${config.baseUrl}/sandboxes`,
      headers: { "X-API-Key": config.apiKey },
      body,
      signal: options.signal,
    })

    return new Sandbox(toSandboxInfo(raw), config)
  }

  /**
   * Connect to an existing sandbox by ID.
   *
   * Fetches the sandbox info and access token, returns a ready-to-use instance.
   *
   * @example
   * ```typescript
   * const sandbox = await Sandbox.connect("sandbox-uuid")
   * ```
   */
  static async connect(
    sandboxId: string,
    options: ConnectionOptions = {},
  ): Promise<Sandbox> {
    const config = resolveConfig(options)

    const raw = await request<ApiSandboxResponse>({
      method: "GET",
      url: `${config.baseUrl}/sandboxes/${sandboxId}`,
      headers: { "X-API-Key": config.apiKey },
      signal: options.signal,
    })

    return new Sandbox(toSandboxInfo(raw), config)
  }

  /**
   * List all sandboxes belonging to the authenticated team.
   *
   * @param options.metadata — Filter by metadata key-value pairs.
   *
   * @example
   * ```typescript
   * const sandboxes = await Sandbox.list()
   * const prodBoxes = await Sandbox.list({ metadata: { env: "prod" } })
   * ```
   */
  static async list(options: SandboxListOptions = {}): Promise<SandboxInfo[]> {
    const config = resolveConfig(options)

    let url = `${config.baseUrl}/sandboxes`
    if (options.metadata && Object.keys(options.metadata).length > 0) {
      const params = new URLSearchParams()
      for (const [key, value] of Object.entries(options.metadata)) {
        params.set(`metadata.${key}`, value)
      }
      url += `?${params.toString()}`
    }

    const raw = await request<ApiSandboxResponse[]>({
      method: "GET",
      url,
      headers: { "X-API-Key": config.apiKey },
      signal: options.signal,
    })

    return raw.map(toSandboxInfo)
  }

  /**
   * Get sandbox info by ID without creating a full Sandbox instance.
   */
  static async get(
    sandboxId: string,
    options: ConnectionOptions = {},
  ): Promise<SandboxInfo> {
    const config = resolveConfig(options)
    const raw = await request<ApiSandboxResponse>({
      method: "GET",
      url: `${config.baseUrl}/sandboxes/${sandboxId}`,
      headers: { "X-API-Key": config.apiKey },
      signal: options.signal,
    })
    return toSandboxInfo(raw)
  }

  /**
   * Delete a sandbox by ID.
   *
   * Idempotent: if the sandbox is already deleted, this is a no-op.
   */
  static async killById(
    sandboxId: string,
    options: ConnectionOptions = {},
  ): Promise<void> {
    const config = resolveConfig(options)
    try {
      await requestVoid({
        method: "DELETE",
        url: `${config.baseUrl}/sandboxes/${sandboxId}`,
        headers: { "X-API-Key": config.apiKey },
        signal: options.signal,
      })
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err
    }
  }

  // -------------------------------------------------------------------------
  // Instance lifecycle methods
  // -------------------------------------------------------------------------

  /**
   * Refresh this sandbox's info from the API and return the fresh data.
   *
   * Note: the returned SandboxInfo reflects the current state. The sandbox
   * instance's own `status` / `metadata` properties are snapshots from
   * construction and are not mutated — use the return value.
   */
  async getInfo(): Promise<SandboxInfo> {
    const raw = await request<ApiSandboxResponse>({
      method: "GET",
      url: `${this._config.baseUrl}/sandboxes/${this.id}`,
      headers: { "X-API-Key": this._config.apiKey },
    })
    return toSandboxInfo(raw)
  }

  /**
   * Pause this sandbox. Snapshots full state (memory + disk), suspends the VM.
   * Status transitions to `idle`.
   */
  async pause(): Promise<SandboxInfo> {
    const raw = await request<ApiSandboxResponse>({
      method: "POST",
      url: `${this._config.baseUrl}/sandboxes/${this.id}/pause`,
      headers: { "X-API-Key": this._config.apiKey },
    })
    return toSandboxInfo(raw)
  }

  /**
   * Resume this sandbox from paused state. Restores from snapshot.
   * Status transitions back to `active`.
   */
  async resume(): Promise<SandboxInfo> {
    const raw = await request<ApiSandboxResponse>({
      method: "POST",
      url: `${this._config.baseUrl}/sandboxes/${this.id}/resume`,
      headers: { "X-API-Key": this._config.apiKey },
    })
    return toSandboxInfo(raw)
  }

  /**
   * Delete this sandbox and all its resources.
   *
   * Idempotent: if the sandbox is already deleted, this is a no-op.
   */
  async kill(): Promise<void> {
    try {
      await requestVoid({
        method: "DELETE",
        url: `${this._config.baseUrl}/sandboxes/${this.id}`,
        headers: { "X-API-Key": this._config.apiKey },
      })
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err
    }
    // Note: can't mutate status (it's readonly). The sandbox is logically deleted.
  }

  /**
   * Partially update this sandbox (metadata, network rules).
   */
  async update(options: SandboxUpdateOptions): Promise<void> {
    const body: Record<string, unknown> = {}
    if (options.metadata !== undefined) body.metadata = options.metadata
    if (options.network !== undefined) {
      body.network = {
        allow_out: options.network.allowOut,
        deny_out: options.network.denyOut,
      }
    }

    await requestVoid({
      method: "PATCH",
      url: `${this._config.baseUrl}/sandboxes/${this.id}`,
      headers: { "X-API-Key": this._config.apiKey },
      body,
    })
  }

  /**
   * Wait for this sandbox to reach `active` status.
   *
   * Useful after `Sandbox.create()` since the API returns immediately
   * with `status: starting`.
   */
  async waitForReady(options: SandboxWaitOptions = {}): Promise<SandboxInfo> {
    const info = await waitForStatus(
      this.id,
      "active",
      this._config.baseUrl,
      this._config.apiKey,
      options,
    )
    return info
  }

  /**
   * Auto-dispose pattern: `await using sandbox = await Sandbox.create(...)`
   * calls kill() on scope exit.
   */
  async [Symbol.asyncDispose](): Promise<void> {
    await this.kill()
  }
}
