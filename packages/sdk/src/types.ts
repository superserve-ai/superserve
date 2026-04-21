/**
 * Core types for the Superserve SDK.
 *
 * These mirror the API response shapes with camelCase field names.
 * The SDK converts snake_case API responses to these types internally.
 */

import { SandboxError } from "./errors.js"

// ---------------------------------------------------------------------------
// Sandbox
// ---------------------------------------------------------------------------

export type SandboxStatus = "active" | "paused"

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
  created_at?: string
  timeout_seconds?: number
  network?: { allow_out?: string[]; deny_out?: string[] }
  metadata?: Record<string, string>
}

/** @internal Response shape from POST /sandboxes/{id}/resume. */
export interface ApiResumeResponse {
  id?: string
  status?: string
  access_token?: string
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

/**
 * @internal Convert an API sandbox response to a SandboxInfo.
 *
 * Requires only `id` and `status`. The raw `access_token` is surfaced only
 * on create + get-by-id and is tracked privately on the Sandbox instance —
 * it is not part of SandboxInfo.
 */
export function toSandboxInfo(raw: ApiSandboxResponse): SandboxInfo {
  if (!raw.id) {
    throw new SandboxError("Invalid API response: missing sandbox id")
  }
  if (!raw.status) {
    throw new SandboxError("Invalid API response: missing sandbox status")
  }

  return {
    id: raw.id,
    name: raw.name ?? "",
    status: raw.status as SandboxStatus,
    vcpuCount: raw.vcpu_count ?? 0,
    memoryMib: raw.memory_mib ?? 0,
    createdAt: raw.created_at ? new Date(raw.created_at) : new Date(),
    timeoutSeconds: raw.timeout_seconds ?? undefined,
    network: raw.network
      ? { allowOut: raw.network.allow_out, denyOut: raw.network.deny_out }
      : undefined,
    metadata: raw.metadata ?? {},
  }
}
