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
  BuildLogEvent,
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

    // Try to resolve the build to follow. If the template has no builds,
    // fall through to polling template status only (no log stream).
    let buildId: string | undefined
    try {
      buildId = await this._resolveBuildId()
    } catch {
      // No builds — wait by polling status; logs unavailable.
    }

    const parseBuildErrorCode = (message?: string): string => {
      if (!message) return "build_failed"
      const match = /^(\w+):/.exec(message)
      return match ? match[1] : "build_failed"
    }

    let finalStatus: "ready" | "failed" | "cancelled" | undefined
    let polledInfo: TemplateInfo | undefined

    if (buildId) {
      try {
        await streamSSE<ApiBuildLogEvent>({
          method: "GET",
          url: `${this._config.baseUrl}/templates/${encodeURIComponent(this.id)}/builds/${encodeURIComponent(buildId)}/logs`,
          headers: { "X-API-Key": this._config.apiKey },
          signal: options.signal,
          onEvent: (raw) => {
            const ev: BuildLogEvent = toBuildLogEvent(raw)
            if (options.onLog) options.onLog(ev)
            if (ev.finished && ev.status) finalStatus = ev.status
          },
        })
      } catch {
        // Fall through to polling.
      }
    }

    // Poll until terminal status (handles both SSE-error and no-buildId cases).
    while (finalStatus === undefined) {
      if (options.signal?.aborted) throw new SandboxError("aborted")
      const info = await this.getInfo()
      if (info.status === "ready" || info.status === "failed") {
        finalStatus = info.status as "ready" | "failed"
        polledInfo = info
        break
      }
      await new Promise((r) => setTimeout(r, pollMs))
    }

    // Reuse the info we just fetched in the poll loop (if any),
    // otherwise fetch fresh — SSE path has no polledInfo.
    const info = polledInfo ?? (await this.getInfo())
    if (finalStatus === "ready") return info
    if (finalStatus === "cancelled") {
      throw new ConflictError("template build was cancelled", "cancelled")
    }
    throw new BuildError(info.errorMessage ?? "build_failed", {
      code: parseBuildErrorCode(info.errorMessage),
      buildId: buildId ?? "",
      templateId: this.id,
    })
  }
}
