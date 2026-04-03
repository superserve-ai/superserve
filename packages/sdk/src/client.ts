import { APIError, SuperserveError } from "./errors"
import { ExecStream } from "./exec-stream"
import { trackEvent } from "./telemetry"
import type {
  ApiCheckpoint,
  ApiExecResponse,
  ApiForkResponse,
  ApiForkTree,
  ApiVm,
  Checkpoint,
  CreateVmOptions,
  ExecOptions,
  ExecResult,
  ForkOptions,
  ForkResult,
  ForkTree,
  RollbackOptions,
  SuperserveOptions,
  Vm,
} from "./types"

const DEFAULT_BASE_URL = "https://api.superserve.ai"
const DEFAULT_TIMEOUT = 30_000

const e = encodeURIComponent

export class Superserve {
  private readonly _apiKey: string
  private readonly _baseUrl: string
  private readonly _timeout: number

  readonly vms: {
    create: (options: CreateVmOptions) => Promise<Vm>
    list: (options?: { status?: string }) => Promise<Vm[]>
    get: (vmId: string) => Promise<Vm>
    delete: (vmId: string) => Promise<void>
    stop: (vmId: string) => Promise<Vm>
    start: (vmId: string) => Promise<Vm>
    sleep: (vmId: string) => Promise<Vm>
    wake: (vmId: string) => Promise<Vm>
  }

  readonly files: {
    upload: (
      vmId: string,
      remotePath: string,
      data: Uint8Array | string,
    ) => Promise<void>
    download: (vmId: string, remotePath: string) => Promise<Uint8Array>
  }

  readonly checkpoints: {
    list: (vmId: string) => Promise<Checkpoint[]>
    create: (
      vmId: string,
      options?: { name?: string },
    ) => Promise<Checkpoint>
    delete: (
      vmId: string,
      checkpointId: string,
      options?: { force?: boolean },
    ) => Promise<void>
  }

  constructor(options: SuperserveOptions) {
    this._apiKey = options.apiKey
    this._baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "")
    this._timeout = options.timeout ?? DEFAULT_TIMEOUT

    this.vms = {
      create: (opts) => this._createVm(opts),
      list: (opts) => this._listVms(opts),
      get: (vmId) => this._getVm(vmId),
      delete: (vmId) => this._deleteVm(vmId),
      stop: (vmId) => this._vmAction(vmId, "stop"),
      start: (vmId) => this._vmAction(vmId, "start"),
      sleep: (vmId) => this._vmAction(vmId, "sleep"),
      wake: (vmId) => this._vmAction(vmId, "wake"),
    }

    this.files = {
      upload: (vmId, remotePath, data) =>
        this._uploadFile(vmId, remotePath, data),
      download: (vmId, remotePath) => this._downloadFile(vmId, remotePath),
    }

    this.checkpoints = {
      list: (vmId) => this._listCheckpoints(vmId),
      create: (vmId, opts) => this._createCheckpoint(vmId, opts),
      delete: (vmId, cpId, opts) =>
        this._deleteCheckpoint(vmId, cpId, opts),
    }

    trackEvent("sdk.init")
  }

  // ==================== Exec ====================

  async exec(vmId: string, options: ExecOptions): Promise<ExecResult> {
    const resp = await this._request("POST", `/vms/${e(vmId)}/exec`, {
      json: {
        command: options.command,
        timeout_s: options.timeoutS,
      },
    })
    const raw = await this._safeJson<ApiExecResponse>(resp)
    trackEvent("sdk.exec")
    return { stdout: raw.stdout, stderr: raw.stderr, exitCode: raw.exit_code }
  }

  execStream(vmId: string, options: ExecOptions): ExecStream {
    const controller = new AbortController()
    const responsePromise = this._request("POST", `/vms/${e(vmId)}/exec/stream`, {
      json: {
        command: options.command,
        timeout_s: options.timeoutS,
      },
      stream: true,
      signal: controller.signal,
    })
    return new ExecStream(responsePromise, controller)
  }

  // ==================== Rollback ====================

  async rollback(vmId: string, options: RollbackOptions): Promise<Vm> {
    const resp = await this._request("POST", `/vms/${e(vmId)}/rollback`, {
      json: {
        checkpoint_id: options.checkpointId,
        name: options.name,
        minutes_ago: options.minutesAgo,
        preserve_newer: options.preserveNewer,
      },
    })
    return mapVm(await this._safeJson<ApiVm>(resp))
  }

  // ==================== Fork ====================

  async fork(vmId: string, options: ForkOptions): Promise<ForkResult> {
    const resp = await this._request("POST", `/vms/${e(vmId)}/fork`, {
      json: {
        count: options.count,
        from_checkpoint_id: options.fromCheckpointId,
      },
    })
    const raw = await this._safeJson<ApiForkResponse>(resp)
    trackEvent("sdk.fork", { count: options.count })
    return {
      sourceVmId: raw.source_vm_id,
      checkpointId: raw.checkpoint_id,
      vms: raw.vms.map(mapVm),
    }
  }

  async forkTree(vmId: string): Promise<ForkTree> {
    const resp = await this._request("GET", `/vms/${e(vmId)}/tree`)
    return mapForkTree(await this._safeJson<ApiForkTree>(resp))
  }

  // ==================== Internal: VM Methods ====================

  private async _createVm(options: CreateVmOptions): Promise<Vm> {
    const resp = await this._request("POST", "/vms", {
      json: {
        name: options.name,
        image: options.image,
        vcpu_count: options.vcpuCount,
        mem_size_mib: options.memSizeMib,
      },
    })
    const vm = mapVm(await this._safeJson<ApiVm>(resp))
    trackEvent("sdk.vm.create")
    return vm
  }

  private async _listVms(options?: { status?: string }): Promise<Vm[]> {
    const params: Record<string, string> = {}
    if (options?.status) params.status = options.status
    const resp = await this._request("GET", "/vms", { params })
    const data = await this._safeJson<{ vms: ApiVm[] }>(resp)
    return (data.vms ?? []).map(mapVm)
  }

  private async _getVm(vmId: string): Promise<Vm> {
    const resp = await this._request("GET", `/vms/${e(vmId)}`)
    return mapVm(await this._safeJson<ApiVm>(resp))
  }

  private async _deleteVm(vmId: string): Promise<void> {
    await this._request("DELETE", `/vms/${e(vmId)}`)
    trackEvent("sdk.vm.delete")
  }

  private async _vmAction(
    vmId: string,
    action: "stop" | "start" | "sleep" | "wake",
  ): Promise<Vm> {
    const resp = await this._request("POST", `/vms/${e(vmId)}/${action}`)
    return mapVm(await this._safeJson<ApiVm>(resp))
  }

  // ==================== Internal: Files ====================

  private async _uploadFile(
    vmId: string,
    remotePath: string,
    data: Uint8Array | string,
  ): Promise<void> {
    const cleanPath = remotePath.replace(/^\//, "")
    const bytes =
      typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data)
    await this._request("PUT", `/vms/${e(vmId)}/files/${cleanPath}`, {
      body: bytes,
      contentType: "application/octet-stream",
    })
  }

  private async _downloadFile(
    vmId: string,
    remotePath: string,
  ): Promise<Uint8Array> {
    const cleanPath = remotePath.replace(/^\//, "")
    const resp = await this._request("GET", `/vms/${e(vmId)}/files/${cleanPath}`)
    const arrayBuf = await resp.arrayBuffer()
    return new Uint8Array(arrayBuf)
  }

  // ==================== Internal: Checkpoints ====================

  private async _listCheckpoints(vmId: string): Promise<Checkpoint[]> {
    const resp = await this._request("GET", `/vms/${e(vmId)}/checkpoints`)
    const data = await this._safeJson<{ checkpoints: ApiCheckpoint[] }>(resp)
    return (data.checkpoints ?? []).map(mapCheckpoint)
  }

  private async _createCheckpoint(
    vmId: string,
    options?: { name?: string },
  ): Promise<Checkpoint> {
    const resp = await this._request("POST", `/vms/${e(vmId)}/checkpoint`, {
      json: { name: options?.name },
    })
    return mapCheckpoint(await this._safeJson<ApiCheckpoint>(resp))
  }

  private async _deleteCheckpoint(
    vmId: string,
    checkpointId: string,
    options?: { force?: boolean },
  ): Promise<void> {
    const params: Record<string, string> = {}
    if (options?.force) params.force = "true"
    await this._request(
      "DELETE",
      `/vms/${e(vmId)}/checkpoints/${e(checkpointId)}`,
      { params },
    )
  }

  // ==================== HTTP Helpers ====================

  /** @internal */
  async _request(
    method: string,
    endpoint: string,
    options: {
      json?: unknown
      body?: BodyInit
      contentType?: string
      params?: Record<string, string>
      stream?: boolean
      signal?: AbortSignal
    } = {},
  ): Promise<Response> {
    const { json, body, contentType, params, stream = false, signal } = options

    let url = `${this._baseUrl}/v1${endpoint}`
    if (params) {
      url += `?${new URLSearchParams(params).toString()}`
    }

    const headers: Record<string, string> = {
      "X-API-Key": this._apiKey,
      "Content-Type": contentType ?? "application/json",
    }

    const controller = new AbortController()
    let timeoutId: ReturnType<typeof setTimeout> | undefined

    if (!stream) {
      timeoutId = setTimeout(() => controller.abort(), this._timeout)
    }

    const combinedSignal = signal
      ? anySignal([signal, controller.signal])
      : controller.signal

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ?? (json ? JSON.stringify(json) : undefined),
        signal: combinedSignal,
      })

      if (timeoutId) clearTimeout(timeoutId)

      if (response.status >= 400) {
        let errorData: Record<string, unknown> = {}
        try {
          errorData = (await response.json()) as Record<string, unknown>
        } catch {
          // ignore parse errors
        }

        const errorObj = errorData.error as
          | { code?: string; message?: string }
          | undefined
        const detail =
          errorObj?.message ??
          ((errorData.detail ?? errorData.message) as string | undefined)
        trackEvent("sdk.error", {
          status: response.status,
          code: errorObj?.code,
        })
        throw new APIError(
          response.status,
          detail ?? response.statusText,
          errorObj as Record<string, unknown> | undefined,
        )
      }

      return response
    } catch (e) {
      if (timeoutId) clearTimeout(timeoutId)
      if (e instanceof APIError) throw e
      if (e instanceof DOMException && e.name === "AbortError") {
        if (signal?.aborted) {
          throw new SuperserveError("Request was aborted")
        }
        throw new APIError(0, "Request timed out")
      }
      throw new APIError(0, "Network request failed")
    }
  }

  /** @internal */
  async _safeJson<T>(response: Response): Promise<T> {
    try {
      return (await response.json()) as T
    } catch {
      throw new APIError(response.status, "Unexpected response from server")
    }
  }
}

// ==================== Mappers ====================

function mapVm(raw: ApiVm): Vm {
  return {
    id: raw.id,
    name: raw.name,
    status: raw.status,
    vcpuCount: raw.vcpu_count,
    memSizeMib: raw.mem_size_mib,
    ipAddress: raw.ip_address,
    createdAt: raw.created_at,
    uptimeSeconds: raw.uptime_seconds,
    lastCheckpointAt: raw.last_checkpoint_at,
    parentVmId: raw.parent_vm_id,
    forkedFromCheckpointId: raw.forked_from_checkpoint_id,
  }
}

function mapCheckpoint(raw: ApiCheckpoint): Checkpoint {
  return {
    id: raw.id,
    vmId: raw.vm_id,
    name: raw.name,
    type: raw.type,
    sizeBytes: raw.size_bytes,
    deltaSizeBytes: raw.delta_size_bytes,
    createdAt: raw.created_at,
    pinned: raw.pinned,
  }
}

function mapForkTree(raw: ApiForkTree): ForkTree {
  return {
    vmId: raw.vm_id,
    name: raw.name,
    status: raw.status,
    forkedFromCheckpointId: raw.forked_from_checkpoint_id,
    children: raw.children.map(mapForkTree),
  }
}

function anySignal(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController()
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason)
      return controller.signal
    }
    signal.addEventListener("abort", () => controller.abort(signal.reason), {
      once: true,
    })
  }
  return controller.signal
}
