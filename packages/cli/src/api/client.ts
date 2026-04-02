import { getApiKey } from "../config/auth"
import {
  DEFAULT_TIMEOUT,
  PLATFORM_API_URL,
  USER_AGENT,
} from "../config/constants"
import { PlatformAPIError, toUserMessage } from "./errors"
import { parseSSEStream } from "./streaming"
import type {
  Checkpoint,
  CreateCheckpointRequest,
  CreateVmRequest,
  ExecRequest,
  ExecResponse,
  ExecStreamEvent,
  ForkRequest,
  ForkResponse,
  ForkTree,
  RollbackRequest,
  Vm,
} from "./types"

export type SuperserveClient = ReturnType<typeof createClient>

export function createClient(
  baseUrl = PLATFORM_API_URL,
  timeout = DEFAULT_TIMEOUT,
) {
  const normalizedUrl = baseUrl.replace(/\/+$/, "")
  let cachedApiKey: string | null = null

  function getHeaders(authenticated = true): Record<string, string> {
    const headers: Record<string, string> = {
      "User-Agent": USER_AGENT,
      "Content-Type": "application/json",
    }
    if (authenticated) {
      if (!cachedApiKey) {
        const apiKey = getApiKey()
        if (!apiKey) {
          throw new PlatformAPIError(
            401,
            "Not authenticated. Run `superserve login` first.",
          )
        }
        cachedApiKey = apiKey
      }
      headers["X-API-Key"] = cachedApiKey
    }
    return headers
  }

  async function request(
    method: string,
    endpoint: string,
    options: {
      json?: unknown
      body?: BodyInit
      params?: Record<string, string>
      stream?: boolean
      authenticated?: boolean
      contentType?: string
    } = {},
  ): Promise<Response> {
    const {
      json,
      body,
      params,
      stream = false,
      authenticated = true,
      contentType,
    } = options

    let url = `${normalizedUrl}/v1${endpoint}`
    if (params) {
      const searchParams = new URLSearchParams(params)
      url += `?${searchParams.toString()}`
    }

    const headers = getHeaders(authenticated)

    if (contentType) {
      headers["Content-Type"] = contentType
    }

    const controller = new AbortController()
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    if (!stream) {
      timeoutId = setTimeout(() => controller.abort(), timeout)
    }

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ?? (json ? JSON.stringify(json) : undefined),
        signal: controller.signal,
      })

      if (timeoutId) clearTimeout(timeoutId)

      if (response.status >= 400) {
        if (response.status === 401) {
          cachedApiKey = null
        }

        let errorData: Record<string, unknown> = {}
        try {
          errorData = (await response.json()) as Record<string, unknown>
        } catch {}

        // Handle new {error: {code, message}} format
        const errorObj = errorData.error as
          | { code?: string; message?: string }
          | undefined
        const rawMessage =
          errorObj?.message ??
          ((errorData.detail ?? errorData.message) as string | undefined) ??
          response.statusText
        throw new PlatformAPIError(
          response.status,
          toUserMessage(response.status, rawMessage),
          errorObj as Record<string, unknown> | undefined,
        )
      }

      return response
    } catch (e) {
      if (timeoutId) clearTimeout(timeoutId)

      if (e instanceof PlatformAPIError) throw e

      if (e instanceof DOMException && e.name === "AbortError") {
        throw new PlatformAPIError(0, "Request timed out")
      }
      if (
        e instanceof TypeError &&
        (e.message.includes("fetch") || e.message.includes("connect"))
      ) {
        throw new PlatformAPIError(0, "Cannot connect to Superserve API")
      }
      throw new PlatformAPIError(0, "Network request failed")
    }
  }

  async function safeJson<T>(response: Response): Promise<T> {
    try {
      return (await response.json()) as T
    } catch {
      throw new PlatformAPIError(
        response.status,
        "Unexpected response from server. Please try again.",
      )
    }
  }

  // ==================== VMs ====================

  async function createVm(req: CreateVmRequest): Promise<Vm> {
    const resp = await request("POST", "/vms", { json: req })
    return safeJson<Vm>(resp)
  }

  async function listVms(status?: string): Promise<Vm[]> {
    const params: Record<string, string> = {}
    if (status) params.status = status
    const resp = await request("GET", "/vms", { params })
    const data = await safeJson<{ vms: Vm[] }>(resp)
    return data.vms ?? []
  }

  async function getVm(vmId: string): Promise<Vm> {
    const resp = await request("GET", `/vms/${encodeURIComponent(vmId)}`)
    return safeJson<Vm>(resp)
  }

  async function deleteVm(vmId: string): Promise<void> {
    await request("DELETE", `/vms/${encodeURIComponent(vmId)}`)
  }

  async function stopVm(vmId: string): Promise<Vm> {
    const resp = await request("POST", `/vms/${encodeURIComponent(vmId)}/stop`)
    return safeJson<Vm>(resp)
  }

  async function startVm(vmId: string): Promise<Vm> {
    const resp = await request("POST", `/vms/${encodeURIComponent(vmId)}/start`)
    return safeJson<Vm>(resp)
  }

  async function sleepVm(vmId: string): Promise<Vm> {
    const resp = await request("POST", `/vms/${encodeURIComponent(vmId)}/sleep`)
    return safeJson<Vm>(resp)
  }

  async function wakeVm(vmId: string): Promise<Vm> {
    const resp = await request("POST", `/vms/${encodeURIComponent(vmId)}/wake`)
    return safeJson<Vm>(resp)
  }

  // ==================== EXEC ====================

  async function exec(vmId: string, req: ExecRequest): Promise<ExecResponse> {
    const resp = await request(
      "POST",
      `/vms/${encodeURIComponent(vmId)}/exec`,
      { json: req },
    )
    return safeJson<ExecResponse>(resp)
  }

  async function* execStream(
    vmId: string,
    req: ExecRequest,
  ): AsyncIterableIterator<ExecStreamEvent> {
    const resp = await request(
      "POST",
      `/vms/${encodeURIComponent(vmId)}/exec/stream`,
      { json: req, stream: true },
    )
    yield* parseSSEStream(resp)
  }

  // ==================== FILES ====================

  async function uploadFile(
    vmId: string,
    remotePath: string,
    data: Uint8Array | Buffer,
    mode?: string,
  ): Promise<void> {
    const headers: Record<string, string> = {}
    if (mode) headers["X-File-Mode"] = mode

    // Strip leading slash from path for the URL
    const cleanPath = remotePath.replace(/^\//, "")
    await request(
      "PUT",
      `/vms/${encodeURIComponent(vmId)}/files/${cleanPath}`,
      {
        body: data,
        contentType: "application/octet-stream",
      },
    )
  }

  async function downloadFile(
    vmId: string,
    remotePath: string,
  ): Promise<Buffer> {
    const cleanPath = remotePath.replace(/^\//, "")
    const resp = await request(
      "GET",
      `/vms/${encodeURIComponent(vmId)}/files/${cleanPath}`,
    )
    const arrayBuf = await resp.arrayBuffer()
    return Buffer.from(arrayBuf)
  }

  // ==================== CHECKPOINTS ====================

  async function listCheckpoints(vmId: string): Promise<Checkpoint[]> {
    const resp = await request(
      "GET",
      `/vms/${encodeURIComponent(vmId)}/checkpoints`,
    )
    const data = await safeJson<{ checkpoints: Checkpoint[] }>(resp)
    return data.checkpoints ?? []
  }

  async function createCheckpoint(
    vmId: string,
    req: CreateCheckpointRequest,
  ): Promise<Checkpoint> {
    const resp = await request(
      "POST",
      `/vms/${encodeURIComponent(vmId)}/checkpoint`,
      { json: req },
    )
    return safeJson<Checkpoint>(resp)
  }

  async function deleteCheckpoint(
    vmId: string,
    checkpointId: string,
    force = false,
  ): Promise<void> {
    const params: Record<string, string> = {}
    if (force) params.force = "true"
    await request(
      "DELETE",
      `/vms/${encodeURIComponent(vmId)}/checkpoints/${encodeURIComponent(checkpointId)}`,
      { params },
    )
  }

  // ==================== ROLLBACK ====================

  async function rollback(vmId: string, req: RollbackRequest): Promise<Vm> {
    const resp = await request(
      "POST",
      `/vms/${encodeURIComponent(vmId)}/rollback`,
      { json: req },
    )
    return safeJson<Vm>(resp)
  }

  // ==================== FORK ====================

  async function fork(vmId: string, req: ForkRequest): Promise<ForkResponse> {
    const resp = await request(
      "POST",
      `/vms/${encodeURIComponent(vmId)}/fork`,
      { json: req },
    )
    return safeJson<ForkResponse>(resp)
  }

  async function getForkTree(vmId: string): Promise<ForkTree> {
    const resp = await request("GET", `/vms/${encodeURIComponent(vmId)}/tree`)
    return safeJson<ForkTree>(resp)
  }

  // ==================== AUTH VALIDATION ====================

  async function validateApiKey(): Promise<boolean> {
    try {
      await listVms()
      return true
    } catch (e) {
      if (e instanceof PlatformAPIError && e.statusCode === 401) {
        return false
      }
      throw e
    }
  }

  return {
    // VMs
    createVm,
    listVms,
    getVm,
    deleteVm,
    stopVm,
    startVm,
    sleepVm,
    wakeVm,
    // Exec
    exec,
    execStream,
    // Files
    uploadFile,
    downloadFile,
    // Checkpoints
    listCheckpoints,
    createCheckpoint,
    deleteCheckpoint,
    // Rollback
    rollback,
    // Fork
    fork,
    getForkTree,
    // Auth
    validateApiKey,
  }
}
