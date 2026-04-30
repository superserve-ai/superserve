/**
 * Template class — reusable sandbox base image with build steps.
 *
 * ```typescript
 * import { Template, Sandbox } from "@superserve/sdk"
 *
 * const template = await Template.create({
 *   alias: "my-python-env",
 *   from: "python:3.11",
 *   steps: [{ run: "pip install numpy" }],
 * })
 * await template.waitUntilReady()
 * const sandbox = await Sandbox.create({ name: "run-1", fromTemplate: template })
 * ```
 */

import { type ResolvedConfig, resolveConfig } from "./config.js"
import {
  BuildError,
  ConflictError,
  NotFoundError,
  SandboxError,
} from "./errors.js"
import { request, requestVoid, streamSSE } from "./http.js"
import type {
  ApiBuildLogEvent,
  ApiCreateTemplateResponse,
  ApiTemplateBuildResponse,
  ApiTemplateResponse,
  BuildLogsOptions,
  ConnectionOptions,
  TemplateBuildInfo,
  TemplateBuildsListOptions,
  TemplateCreateOptions,
  TemplateInfo,
  TemplateListOptions,
  TemplateStatus,
  WaitUntilReadyOptions,
} from "./types.js"
import {
  buildStepsToApi,
  toBuildLogEvent,
  toTemplateBuildInfo,
  toTemplateInfo,
} from "./types.js"

export class Template {
  readonly id: string
  readonly alias: string
  readonly teamId: string
  readonly status: TemplateStatus
  readonly vcpu: number
  readonly memoryMib: number
  readonly diskMib: number
  readonly sizeBytes?: number
  readonly errorMessage?: string
  readonly createdAt: Date
  readonly builtAt?: Date
  readonly latestBuildId?: string

  private readonly _config: ResolvedConfig

  /** @internal — use `Template.create()` / `Template.connect()` instead. */
  private constructor(info: TemplateInfo, config: ResolvedConfig) {
    this.id = info.id
    this.alias = info.alias
    this.teamId = info.teamId
    this.status = info.status
    this.vcpu = info.vcpu
    this.memoryMib = info.memoryMib
    this.diskMib = info.diskMib
    this.sizeBytes = info.sizeBytes
    this.errorMessage = info.errorMessage
    this.createdAt = info.createdAt
    this.builtAt = info.builtAt
    this.latestBuildId = info.latestBuildId
    this._config = config
  }

  // -------------------------------------------------------------------------
  // Static factories
  // -------------------------------------------------------------------------

  static async create(options: TemplateCreateOptions): Promise<Template> {
    const config = resolveConfig(options)

    const buildSpec: Record<string, unknown> = { from: options.from }
    if (options.steps !== undefined)
      buildSpec.steps = buildStepsToApi(options.steps)
    if (options.startCmd !== undefined) buildSpec.start_cmd = options.startCmd
    if (options.readyCmd !== undefined) buildSpec.ready_cmd = options.readyCmd

    const body: Record<string, unknown> = {
      alias: options.alias,
      build_spec: buildSpec,
    }
    if (options.vcpu !== undefined) body.vcpu = options.vcpu
    if (options.memoryMib !== undefined) body.memory_mib = options.memoryMib
    if (options.diskMib !== undefined) body.disk_mib = options.diskMib

    const raw = await request<ApiCreateTemplateResponse>({
      method: "POST",
      url: `${config.baseUrl}/templates`,
      headers: { "X-API-Key": config.apiKey },
      body,
      signal: options.signal,
    })

    if (!raw.build_id) {
      throw new SandboxError(
        "Invalid API response from POST /templates: missing build_id",
      )
    }
    return new Template(toTemplateInfo(raw, raw.build_id), config)
  }

  static async connect(
    aliasOrId: string,
    options: ConnectionOptions = {},
  ): Promise<Template> {
    const config = resolveConfig(options)
    const raw = await request<ApiTemplateResponse>({
      method: "GET",
      url: `${config.baseUrl}/templates/${encodeURIComponent(aliasOrId)}`,
      headers: { "X-API-Key": config.apiKey },
      signal: options.signal,
    })
    return new Template(toTemplateInfo(raw), config)
  }

  static async list(
    options: TemplateListOptions = {},
  ): Promise<TemplateInfo[]> {
    const config = resolveConfig(options)
    let url = `${config.baseUrl}/templates`
    if (options.aliasPrefix) {
      const qs = new URLSearchParams({ alias_prefix: options.aliasPrefix })
      url += `?${qs.toString()}`
    }

    const raw = await request<ApiTemplateResponse[]>({
      method: "GET",
      url,
      headers: { "X-API-Key": config.apiKey },
      signal: options.signal,
    })
    return raw.map((t) => toTemplateInfo(t))
  }

  static async deleteById(
    aliasOrId: string,
    options: ConnectionOptions = {},
  ): Promise<void> {
    const config = resolveConfig(options)
    try {
      await requestVoid({
        method: "DELETE",
        url: `${config.baseUrl}/templates/${encodeURIComponent(aliasOrId)}`,
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

  async getInfo(): Promise<TemplateInfo> {
    const raw = await request<ApiTemplateResponse>({
      method: "GET",
      url: `${this._config.baseUrl}/templates/${encodeURIComponent(this.id)}`,
      headers: { "X-API-Key": this._config.apiKey },
    })
    return toTemplateInfo(raw)
  }

  async delete(): Promise<void> {
    try {
      await requestVoid({
        method: "DELETE",
        url: `${this._config.baseUrl}/templates/${encodeURIComponent(this.id)}`,
        headers: { "X-API-Key": this._config.apiKey },
      })
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err
    }
  }

  async rebuild(): Promise<TemplateBuildInfo> {
    const raw = await request<ApiTemplateBuildResponse>({
      method: "POST",
      url: `${this._config.baseUrl}/templates/${encodeURIComponent(this.id)}/builds`,
      headers: { "X-API-Key": this._config.apiKey },
    })
    return toTemplateBuildInfo(raw)
  }

  async listBuilds(
    options: TemplateBuildsListOptions = {},
  ): Promise<TemplateBuildInfo[]> {
    let url = `${this._config.baseUrl}/templates/${encodeURIComponent(this.id)}/builds`
    if (options.limit !== undefined) {
      url += `?limit=${options.limit}`
    }
    const raw = await request<ApiTemplateBuildResponse[]>({
      method: "GET",
      url,
      headers: { "X-API-Key": this._config.apiKey },
      signal: options.signal,
    })
    return raw.map(toTemplateBuildInfo)
  }

  async getBuild(buildId: string): Promise<TemplateBuildInfo> {
    const raw = await request<ApiTemplateBuildResponse>({
      method: "GET",
      url: `${this._config.baseUrl}/templates/${encodeURIComponent(this.id)}/builds/${encodeURIComponent(buildId)}`,
      headers: { "X-API-Key": this._config.apiKey },
    })
    return toTemplateBuildInfo(raw)
  }

  async cancelBuild(buildId: string): Promise<void> {
    try {
      await requestVoid({
        method: "DELETE",
        url: `${this._config.baseUrl}/templates/${encodeURIComponent(this.id)}/builds/${encodeURIComponent(buildId)}`,
        headers: { "X-API-Key": this._config.apiKey },
      })
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err
    }
  }

  /**
   * Resolve the build to operate on — explicit `buildId`, then `latestBuildId`
   * captured at construction (set on `Template.create`), then a lookup of the
   * most recent build via `listBuilds`. Throws if the template has no builds.
   */
  private async _resolveBuildId(buildId?: string): Promise<string> {
    if (buildId) return buildId
    if (this.latestBuildId) return this.latestBuildId

    const recent = await this.listBuilds({ limit: 1 })
    if (recent.length === 0) {
      throw new SandboxError(
        `Template ${this.alias} has no builds — call rebuild() first`,
      )
    }
    return recent[0].id
  }

  async streamBuildLogs(options: BuildLogsOptions): Promise<void> {
    const buildId = await this._resolveBuildId(options.buildId)
    await streamSSE<ApiBuildLogEvent>({
      method: "GET",
      url: `${this._config.baseUrl}/templates/${encodeURIComponent(this.id)}/builds/${encodeURIComponent(buildId)}/logs`,
      headers: { "X-API-Key": this._config.apiKey },
      signal: options.signal,
      onEvent: (raw) => options.onEvent(toBuildLogEvent(raw)),
    })
  }

  async waitUntilReady(
    options: WaitUntilReadyOptions = {},
  ): Promise<TemplateInfo> {
    const pollMs = options.pollIntervalMs ?? 2000

    let buildId: string | undefined
    try {
      buildId = await this._resolveBuildId()
    } catch {
      // No builds — fall through to polling template status (no log stream).
    }

    // SSE is for live logs only. The server emits `finished:true,
    // status:"ready"` the instant the builder finishes, but the DB row
    // that POST /sandboxes reads is updated by a separate ~1s poller.
    // Treating SSE as the terminal-state signal would race that update
    // and leave callers seeing 409 "template is not ready" on the very
    // next request. Source of truth is the DB-backed build endpoint.
    const sseAbort = new AbortController()
    const sseSignal = options.signal
      ? AbortSignal.any([sseAbort.signal, options.signal])
      : sseAbort.signal
    let ssePromise: Promise<void> | undefined
    if (buildId && options.onLog) {
      ssePromise = streamSSE<ApiBuildLogEvent>({
        method: "GET",
        url: `${this._config.baseUrl}/templates/${encodeURIComponent(this.id)}/builds/${encodeURIComponent(buildId)}/logs`,
        headers: { "X-API-Key": this._config.apiKey },
        signal: sseSignal,
        onEvent: (raw) => options.onLog?.(toBuildLogEvent(raw)),
      }).catch(() => {
        // SSE failures are non-fatal — polling drives terminal detection.
      })
    }

    /**
     * Split a backend `error_message` into a stable code and a clean
     * human-readable message. Backend convention is `"<code>: <detail>"`
     * (e.g. `"image_too_large: image is too large for disk_mib"`). When
     * the message is missing or unprefixed, fall back to `build_failed`
     * + a generic message.
     */
    const parseBuildError = (
      errorMessage?: string,
    ): { code: string; message: string } => {
      if (!errorMessage) {
        return { code: "build_failed", message: "Template build failed" }
      }
      const match = /^(\w+):\s*(.*)$/s.exec(errorMessage)
      if (match && match[2].trim().length > 0) {
        return { code: match[1], message: match[2].trim() }
      }
      return { code: "build_failed", message: errorMessage }
    }

    try {
      if (buildId) {
        // Build status transitions pending → building → snapshotting → ready/failed/cancelled.
        // Template-level status reflects the *latest successful* build, so
        // polling the template would say "ready" instantly when rebuilding
        // an already-ready template. The build-level row is what we need.
        while (true) {
          if (options.signal?.aborted) throw new SandboxError("aborted")
          const build = await this.getBuild(buildId)
          if (build.status === "ready") return await this.getInfo()
          if (build.status === "failed") {
            const { code, message } = parseBuildError(build.errorMessage)
            throw new BuildError(message, {
              code,
              buildId,
              templateId: this.id,
            })
          }
          if (build.status === "cancelled") {
            throw new ConflictError("template build was cancelled", "cancelled")
          }
          await new Promise((r) => setTimeout(r, pollMs))
        }
      }

      // No build_id — rare path; poll template status as a best effort.
      while (true) {
        if (options.signal?.aborted) throw new SandboxError("aborted")
        const info = await this.getInfo()
        if (info.status === "ready") return info
        if (info.status === "failed") {
          const { code, message } = parseBuildError(info.errorMessage)
          throw new BuildError(message, {
            code,
            buildId: "",
            templateId: this.id,
          })
        }
        await new Promise((r) => setTimeout(r, pollMs))
      }
    } finally {
      sseAbort.abort()
      if (ssePromise) await ssePromise
    }
  }
}
