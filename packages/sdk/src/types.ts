/**
 * Core types for the Superserve SDK.
 *
 * These mirror the API response shapes with camelCase field names.
 * The SDK converts snake_case API responses to these types internally.
 */

// ---------------------------------------------------------------------------
// Sandbox
// ---------------------------------------------------------------------------

export type SandboxStatus =
  | "starting"
  | "active"
  | "pausing"
  | "idle"
  | "failed"
  | "deleted"

export interface NetworkConfig {
  allowOut?: string[]
  denyOut?: string[]
}

export interface SandboxInfo {
  id: string
  name: string
  status: SandboxStatus
  vcpuCount: number
  memoryMib: number
  accessToken: string
  snapshotId?: string
  createdAt: Date
  timeoutSeconds?: number
  network?: NetworkConfig
  metadata: Record<string, string>
}

// ---------------------------------------------------------------------------
// Sandbox Options
// ---------------------------------------------------------------------------

export interface ConnectionOptions {
  apiKey?: string
  baseUrl?: string
  signal?: AbortSignal
}

export interface SandboxCreateOptions extends ConnectionOptions {
  name: string
  fromSnapshot?: string
  timeoutSeconds?: number
  metadata?: Record<string, string>
  envVars?: Record<string, string>
  network?: NetworkConfig
}

export interface SandboxListOptions extends ConnectionOptions {
  metadata?: Record<string, string>
}

export interface SandboxUpdateOptions {
  metadata?: Record<string, string>
  network?: NetworkConfig
}

export interface SandboxWaitOptions {
  timeoutMs?: number
  intervalMs?: number
  signal?: AbortSignal
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export interface CommandResult {
  stdout: string
  stderr: string
  exitCode: number
}

export interface CommandOptions {
  cwd?: string
  env?: Record<string, string>
  timeoutMs?: number
  onStdout?: (data: string) => void
  onStderr?: (data: string) => void
  signal?: AbortSignal
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

export type FileInput = string | Uint8Array | ArrayBuffer | Blob

// ---------------------------------------------------------------------------
// Internal: API response shapes (snake_case, as returned by the API)
// ---------------------------------------------------------------------------

/** @internal */
export interface ApiSandboxResponse {
  id?: string
  name?: string
  status?: string
  vcpu_count?: number
  memory_mib?: number
  access_token?: string
  snapshot_id?: string
  created_at?: string
  timeout_seconds?: number
  network?: { allow_out?: string[]; deny_out?: string[] }
  metadata?: Record<string, string>
}

/** @internal */
export interface ApiExecResult {
  stdout?: string
  stderr?: string
  exit_code?: number
}

/** @internal */
export interface ApiExecStreamEvent {
  timestamp?: string
  stdout?: string
  stderr?: string
  exit_code?: number
  finished?: boolean
  error?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** @internal Convert an API sandbox response to a SandboxInfo. */
export function toSandboxInfo(raw: ApiSandboxResponse): SandboxInfo {
  if (!raw.id) {
    throw new Error("Invalid API response: missing sandbox id")
  }
  if (!raw.status) {
    throw new Error("Invalid API response: missing sandbox status")
  }
  if (!raw.access_token) {
    throw new Error("Invalid API response: missing access_token")
  }

  return {
    id: raw.id,
    name: raw.name ?? "",
    status: raw.status as SandboxStatus,
    vcpuCount: raw.vcpu_count ?? 0,
    memoryMib: raw.memory_mib ?? 0,
    accessToken: raw.access_token,
    snapshotId: raw.snapshot_id ?? undefined,
    createdAt: raw.created_at ? new Date(raw.created_at) : new Date(),
    timeoutSeconds: raw.timeout_seconds ?? undefined,
    network: raw.network
      ? { allowOut: raw.network.allow_out, denyOut: raw.network.deny_out }
      : undefined,
    metadata: raw.metadata ?? {},
  }
}
