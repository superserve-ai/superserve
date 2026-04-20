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
import type {
  ApiResumeResponse,
  ApiSandboxResponse,
  ConnectionOptions,
  SandboxCreateOptions,
  SandboxInfo,
  SandboxListOptions,
  SandboxStatus,
  SandboxUpdateOptions,
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

  /** Execute shell commands inside this sandbox. */
  readonly commands: Commands

  /**
   * Upload and download files to/from this sandbox.
   *
   * Rebuilt transparently after `resume()` to pick up the rotated token.
   */
  files: Files

  private _accessToken: string
  private readonly _config: ResolvedConfig

  /** @internal — Use Sandbox.create() or Sandbox.connect() instead. */
  private constructor(
    info: SandboxInfo,
    accessToken: string,
    config: ResolvedConfig,
  ) {
    this.id = info.id
    this.name = info.name
    this.status = info.status
    this.metadata = info.metadata
    this._accessToken = accessToken
    this._config = config

    this.commands = new Commands(config.baseUrl, this.id, config.apiKey)
    this.files = new Files(this.id, config.sandboxHost, this._accessToken)
  }

  // -------------------------------------------------------------------------
  // Static factory methods
  // -------------------------------------------------------------------------

  /**
   * Create a new sandbox and return a connected Sandbox instance.
   *
   * The request is synchronous: once it resolves, the sandbox is `active`
   * and ready to execute commands and file operations.
   *
   * @example
   * ```typescript
   * const sandbox = await Sandbox.create({ name: "my-sandbox" })
   * const result = await sandbox.commands.run("echo hello")
   * ```
   */
  static async create(options: SandboxCreateOptions): Promise<Sandbox> {
    const config = resolveConfig(options)

    const body: Record<string, unknown> = { name: options.name }
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

    if (!raw.access_token) {
      throw new SandboxError(
        "Invalid API response from POST /sandboxes: missing access_token",
      )
    }
    return new Sandbox(toSandboxInfo(raw), raw.access_token, config)
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

    if (!raw.access_token) {
      throw new SandboxError(
        "Invalid API response from GET /sandboxes/{id}: missing access_token",
      )
    }
    return new Sandbox(toSandboxInfo(raw), raw.access_token, config)
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
   * Pause this sandbox. The sandbox transitions to `idle`.
   * All running processes and file state are preserved.
   */
  async pause(): Promise<void> {
    await requestVoid({
      method: "POST",
      url: `${this._config.baseUrl}/sandboxes/${this.id}/pause`,
      headers: { "X-API-Key": this._config.apiKey },
    })
  }

  /**
   * Resume a paused sandbox. Status transitions back to `active`.
   * The access token is rotated; the SDK updates the files sub-module
   * transparently.
   */
  async resume(): Promise<void> {
    const raw = await request<ApiResumeResponse>({
      method: "POST",
      url: `${this._config.baseUrl}/sandboxes/${this.id}/resume`,
      headers: { "X-API-Key": this._config.apiKey },
    })
    if (!raw.access_token) {
      throw new SandboxError(
        "Invalid API response from POST /sandboxes/{id}/resume: missing access_token",
      )
    }
    this._accessToken = raw.access_token
    // Rebuild files sub-module with fresh token
    this.files = new Files(this.id, this._config.sandboxHost, this._accessToken)
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
   * Auto-dispose pattern: `await using sandbox = await Sandbox.create(...)`
   * calls kill() on scope exit.
   */
  async [Symbol.asyncDispose](): Promise<void> {
    await this.kill()
  }
}
