import { type ResolvedConfig, resolveConfig } from "./config.js"
import { NotFoundError, SandboxError, ValidationError } from "./errors.js"
import { request, requestVoid } from "./http.js"
import type { Sandbox } from "./Sandbox.js"
import type { ConnectionOptions } from "./types.js"

export type VolumeStatus =
  | "creating"
  | "ready"
  | "deleting"
  | "deleted"
  | "error"
export type VolumeAttachmentStatus =
  | "preparing"
  | "mounting"
  | "mounted"
  | "suspending"
  | "suspended"
  | "detaching"
  | "revoking"
  | "revoked"
  | "error"

export interface VolumeInfo {
  id: string
  name: string
  capacityBytes: number
  usedBytes: number
  region: string
  status: VolumeStatus
  generation: number
  errorCode?: string
  createdAt: Date
  updatedAt: Date
}
export interface VolumeAttachment {
  id: string
  volumeId: string
  sandboxId: string
  mountPath: string
  readOnly: boolean
  status: VolumeAttachmentStatus
  generation: number
  leaseExpiresAt: Date
  errorCode?: string
  createdAt: Date
  updatedAt: Date
}
export interface VolumeRequestOptions {
  signal?: AbortSignal
  /** Request timeout; create and attach default to 180 seconds. */
  timeoutMs?: number
}
export interface VolumeCreateOptions
  extends ConnectionOptions, VolumeRequestOptions {
  name: string
  capacityBytes?: number
  /** Reuse this key when retrying an uncertain create response. */
  idempotencyKey?: string
}
export interface VolumeListOptions extends ConnectionOptions {
  limit?: number
}
export interface VolumeAttachOptions extends VolumeRequestOptions {
  mountPath: string
  readOnly?: boolean
  /** Reuse this key when retrying an uncertain attach response. */
  idempotencyKey?: string
}
export interface SandboxVolumeMount extends VolumeAttachOptions {
  /** Existing volume name, UUID, or handle. Volumes are never auto-created. */
  volume: Volume | string
}

interface ApiVolume {
  id: string
  name: string
  capacity_bytes: number
  used_bytes: number
  region: string
  status: VolumeStatus
  generation: number
  error_code?: string
  created_at: string
  updated_at: string
}
interface ApiAttachment {
  id: string
  volume_id: string
  sandbox_id: string
  mount_path: string
  read_only: boolean
  status: VolumeAttachmentStatus
  generation: number
  lease_expires_at: string
  error_code?: string
  created_at: string
  updated_at: string
}
function volumeInfo(raw: ApiVolume): VolumeInfo {
  return {
    id: raw.id,
    name: raw.name,
    capacityBytes: raw.capacity_bytes,
    usedBytes: raw.used_bytes,
    region: raw.region,
    status: raw.status,
    generation: raw.generation,
    errorCode: raw.error_code,
    createdAt: new Date(raw.created_at),
    updatedAt: new Date(raw.updated_at),
  }
}
function attachmentInfo(raw: ApiAttachment): VolumeAttachment {
  return {
    id: raw.id,
    volumeId: raw.volume_id,
    sandboxId: raw.sandbox_id,
    mountPath: raw.mount_path,
    readOnly: raw.read_only,
    status: raw.status,
    generation: raw.generation,
    errorCode: raw.error_code,
    leaseExpiresAt: new Date(raw.lease_expires_at),
    createdAt: new Date(raw.created_at),
    updatedAt: new Date(raw.updated_at),
  }
}
function operationTimeout(value?: number): number {
  if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
    throw new ValidationError("timeoutMs must be a positive finite number")
  }
  return value ?? 180_000
}
function idempotencyKey(value?: string): string {
  if (value !== undefined) return value
  return (
    globalThis.crypto?.randomUUID?.() ??
    "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const random = Math.floor(Math.random() * 16)
      return (c === "x" ? random : (random & 3) | 8).toString(16)
    })
  )
}

const volumeSandboxIdPattern =
  /^(?:sb-([A-Za-z0-9]+)-)?([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/

/** @internal Native attachments and older callers may use the bare UUID. */
export function sameVolumeSandbox(a: string, b: string): boolean {
  const left = volumeSandboxIdPattern.exec(a)
  const right = volumeSandboxIdPattern.exec(b)
  if (!left || !right || left[0] !== a || right[0] !== b) return a === b
  return (
    left[2].toLowerCase() === right[2].toLowerCase() &&
    (left[1] === undefined || right[1] === undefined || left[1] === right[1])
  )
}

/** @internal Compare captured connection identity without exposing credentials. */
export function assertVolumeConnection(
  a: ResolvedConfig,
  b: ResolvedConfig,
): void {
  if (
    a.apiKey !== b.apiKey ||
    a.baseUrl.replace(/\/+$/, "") !== b.baseUrl.replace(/\/+$/, "")
  ) {
    throw new ValidationError(
      "Volume and sandbox must use the same API connection",
    )
  }
}

/** Persistent, provider-neutral storage managed by the native volume API. */
export class Volume {
  readonly id: string
  readonly name: string
  readonly capacityBytes: number
  readonly usedBytes: number
  readonly region: string
  readonly status: VolumeStatus
  readonly generation: number
  readonly errorCode?: string
  readonly createdAt: Date
  readonly updatedAt: Date
  private constructor(
    info: VolumeInfo,
    private readonly _config: ResolvedConfig,
  ) {
    this.id = info.id
    this.name = info.name
    this.capacityBytes = info.capacityBytes
    this.usedBytes = info.usedBytes
    this.region = info.region
    this.status = info.status
    this.generation = info.generation
    this.errorCode = info.errorCode
    this.createdAt = info.createdAt
    this.updatedAt = info.updatedAt
  }
  /** @internal Used before creating a new sandbox with existing volume handles. */
  _assertConnection(config: ResolvedConfig): void {
    assertVolumeConnection(this._config, config)
  }

  static async create(options: VolumeCreateOptions): Promise<Volume> {
    const config = resolveConfig(options)
    const body: Record<string, unknown> = {
      name: options.name,
      idempotency_key: idempotencyKey(options.idempotencyKey),
    }
    if (options.capacityBytes !== undefined)
      body.capacity_bytes = options.capacityBytes
    const raw = await request<ApiVolume>({
      method: "POST",
      url: `${config.baseUrl}/volumes`,
      headers: { "X-API-Key": config.apiKey },
      body,
      signal: options.signal,
      timeoutMs: operationTimeout(options.timeoutMs),
    })
    return new Volume(volumeInfo(raw), config)
  }
  static async connect(
    nameOrId: string,
    options: ConnectionOptions & VolumeRequestOptions = {},
  ): Promise<Volume> {
    const config = resolveConfig(options)
    const raw = await request<ApiVolume>({
      method: "GET",
      url: `${config.baseUrl}/volumes/${encodeURIComponent(nameOrId)}`,
      headers: { "X-API-Key": config.apiKey },
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    })
    return new Volume(volumeInfo(raw), config)
  }
  static async list(options: VolumeListOptions = {}): Promise<VolumeInfo[]> {
    if (
      options.limit !== undefined &&
      (!Number.isInteger(options.limit) ||
        options.limit < 1 ||
        options.limit > 100)
    ) {
      throw new ValidationError("limit must be an integer between 1 and 100")
    }
    const config = resolveConfig(options)
    const query = options.limit === undefined ? "" : `?limit=${options.limit}`
    const raw = await request<ApiVolume[]>({
      method: "GET",
      url: `${config.baseUrl}/volumes${query}`,
      headers: { "X-API-Key": config.apiKey },
      signal: options.signal,
    })
    return raw.map(volumeInfo)
  }
  static async deleteById(
    nameOrId: string,
    options: ConnectionOptions = {},
  ): Promise<void> {
    const config = resolveConfig(options)
    try {
      await requestVoid({
        method: "DELETE",
        url: `${config.baseUrl}/volumes/${encodeURIComponent(nameOrId)}`,
        headers: { "X-API-Key": config.apiKey },
        signal: options.signal,
      })
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error
    }
  }
  async getInfo(options: VolumeRequestOptions = {}): Promise<VolumeInfo> {
    const raw = await request<ApiVolume>({
      method: "GET",
      url: `${this._config.baseUrl}/volumes/${encodeURIComponent(this.id)}`,
      headers: { "X-API-Key": this._config.apiKey },
      ...options,
    })
    return volumeInfo(raw)
  }
  async delete(options: VolumeRequestOptions = {}): Promise<void> {
    try {
      await requestVoid({
        method: "DELETE",
        url: `${this._config.baseUrl}/volumes/${encodeURIComponent(this.id)}`,
        headers: { "X-API-Key": this._config.apiKey },
        ...options,
      })
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error
    }
  }
  async attach(
    sandbox: Sandbox | string,
    options: VolumeAttachOptions,
  ): Promise<VolumeAttachment> {
    if (typeof sandbox !== "string") sandbox._assertVolumeConfig(this._config)
    const sandboxId = typeof sandbox === "string" ? sandbox : sandbox.id
    const raw = await request<ApiAttachment>({
      method: "POST",
      url: `${this._config.baseUrl}/sandboxes/${encodeURIComponent(sandboxId)}/volumes`,
      headers: { "X-API-Key": this._config.apiKey },
      signal: options.signal,
      timeoutMs: operationTimeout(options.timeoutMs),
      body: {
        volume_id: this.id,
        mount_path: options.mountPath,
        ...(options.readOnly === undefined
          ? {}
          : { read_only: options.readOnly }),
        idempotency_key: idempotencyKey(options.idempotencyKey),
      },
    })
    const attachment = attachmentInfo(raw)
    if (
      attachment.status !== "mounted" ||
      attachment.volumeId !== this.id ||
      !sameVolumeSandbox(attachment.sandboxId, sandboxId) ||
      attachment.mountPath !== options.mountPath ||
      attachment.readOnly !== (options.readOnly ?? false)
    ) {
      throw new SandboxError(
        "Volume attach response did not confirm the requested mount",
      )
    }
    return attachment
  }
  async listAttachments(
    options: VolumeRequestOptions = {},
  ): Promise<VolumeAttachment[]> {
    const raw = await request<ApiAttachment[]>({
      method: "GET",
      url: `${this._config.baseUrl}/volumes/${encodeURIComponent(this.id)}/attachments`,
      headers: { "X-API-Key": this._config.apiKey },
      ...options,
    })
    return raw.map(attachmentInfo)
  }
  async getAttachment(
    attachmentId: string,
    options: VolumeRequestOptions = {},
  ): Promise<VolumeAttachment> {
    const info = await getVolumeAttachment(this._config, attachmentId, options)
    if (info.volumeId !== this.id)
      throw new ValidationError("Attachment belongs to a different volume")
    return info
  }
  async detach(
    attachmentId: string,
    options: VolumeRequestOptions = {},
  ): Promise<void> {
    try {
      await this.getAttachment(attachmentId, options)
    } catch (error) {
      if (error instanceof NotFoundError) return
      throw error
    }
    await detachVolumeAttachment(this._config, attachmentId, options)
  }
}

/** @internal Shared native HTTP operations used by Sandbox conveniences. */
export async function getVolumeAttachment(
  config: ResolvedConfig,
  id: string,
  options: VolumeRequestOptions = {},
): Promise<VolumeAttachment> {
  const raw = await request<ApiAttachment>({
    method: "GET",
    url: `${config.baseUrl}/volume-attachments/${encodeURIComponent(id)}`,
    headers: { "X-API-Key": config.apiKey },
    ...options,
  })
  return attachmentInfo(raw)
}
/** @internal */
export async function detachVolumeAttachment(
  config: ResolvedConfig,
  id: string,
  options: VolumeRequestOptions = {},
): Promise<void> {
  try {
    await requestVoid({
      method: "DELETE",
      url: `${config.baseUrl}/volume-attachments/${encodeURIComponent(id)}`,
      headers: { "X-API-Key": config.apiKey },
      ...options,
    })
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error
  }
}
