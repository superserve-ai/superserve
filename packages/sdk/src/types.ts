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

export type SandboxStatus = "active" | "paused" | "resuming" | "failed"

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
  /** Template alias, UUID, or Template instance. */
  fromTemplate?: string | { alias?: string; id: string }
  /** Snapshot UUID. */
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
 * on create + get-by-id and is tracked privately on the `sandbox` -
 * it is not part of SandboxInfo.
 */
export function toSandboxInfo(raw: ApiSandboxResponse): SandboxInfo {
  if (!raw.id) {
    throw new SandboxError("Invalid API response: missing sandbox id")
  }
  if (!raw.status) {
    throw new SandboxError("Invalid API response: missing sandbox status")
  }
  if (!raw.created_at) {
    throw new SandboxError("Invalid API response: missing created_at")
  }

  return {
    id: raw.id,
    name: raw.name ?? "",
    status: raw.status as SandboxStatus,
    vcpuCount: raw.vcpu_count ?? 0,
    memoryMib: raw.memory_mib ?? 0,
    createdAt: new Date(raw.created_at),
    timeoutSeconds: raw.timeout_seconds ?? undefined,
    network: raw.network
      ? { allowOut: raw.network.allow_out, denyOut: raw.network.deny_out }
      : undefined,
    metadata: raw.metadata ?? {},
  }
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

export type TemplateStatus = "pending" | "building" | "ready" | "failed"

export type TemplateBuildStatus =
  | "pending"
  | "building"
  | "snapshotting"
  | "ready"
  | "failed"
  | "cancelled"

export type BuildLogStream = "stdout" | "stderr" | "system"

export interface TemplateInfo {
  id: string
  alias: string
  teamId: string
  status: TemplateStatus
  vcpu: number
  memoryMib: number
  diskMib: number
  sizeBytes?: number
  errorMessage?: string
  createdAt: Date
  builtAt?: Date
  latestBuildId?: string
}

export interface TemplateBuildInfo {
  id: string
  templateId: string
  status: TemplateBuildStatus
  buildSpecHash: string
  errorMessage?: string
  startedAt?: Date
  finalizedAt?: Date
  createdAt: Date
}

export interface BuildLogEvent {
  timestamp: Date
  stream: BuildLogStream
  text: string
  finished?: boolean
  status?: "ready" | "failed" | "cancelled"
}

// Discriminated union: exactly one of the four fields is present.
export type BuildStep =
  | { run: string }
  | { env: { key: string; value: string } }
  | { workdir: string }
  | { user: { name: string; sudo?: boolean } }

export interface TemplateCreateOptions extends ConnectionOptions {
  alias: string
  vcpu?: number
  memoryMib?: number
  diskMib?: number
  from: string
  steps?: BuildStep[]
  startCmd?: string
  readyCmd?: string
}

export interface TemplateListOptions extends ConnectionOptions {
  aliasPrefix?: string
}

export interface TemplateBuildsListOptions extends ConnectionOptions {
  limit?: number
}

export interface BuildLogsOptions {
  onEvent: (ev: BuildLogEvent) => void
  buildId?: string
  signal?: AbortSignal
}

export interface WaitUntilReadyOptions {
  onLog?: (ev: BuildLogEvent) => void
  signal?: AbortSignal
  pollIntervalMs?: number
}

// ---------------------------------------------------------------------------
// Internal: Template API shapes
// ---------------------------------------------------------------------------

/** @internal */
export interface ApiTemplateResponse {
  id?: string
  team_id?: string
  alias?: string
  status?: string
  vcpu?: number
  memory_mib?: number
  disk_mib?: number
  size_bytes?: number
  error_message?: string
  created_at?: string
  built_at?: string
  latest_build_id?: string
}

/** @internal */
export interface ApiTemplateBuildResponse {
  id?: string
  template_id?: string
  status?: string
  build_spec_hash?: string
  error_message?: string
  started_at?: string
  finalized_at?: string
  created_at?: string
}

/** @internal */
export interface ApiCreateTemplateResponse extends ApiTemplateResponse {
  build_id?: string
}

/** @internal */
export interface ApiBuildLogEvent {
  timestamp?: string
  stream?: string
  text?: string
  finished?: boolean
  status?: string
}

// ---------------------------------------------------------------------------
// Template converters
// ---------------------------------------------------------------------------

export function toTemplateInfo(
  raw: ApiTemplateResponse,
  latestBuildId?: string,
): TemplateInfo {
  if (!raw.id) {
    throw new SandboxError("Invalid API response: missing template id")
  }
  if (!raw.alias) {
    throw new SandboxError("Invalid API response: missing template alias")
  }
  if (!raw.status) {
    throw new SandboxError("Invalid API response: missing template status")
  }
  if (!raw.team_id) {
    throw new SandboxError("Invalid API response: missing team_id")
  }
  if (!raw.created_at) {
    throw new SandboxError("Invalid API response: missing created_at")
  }

  return {
    id: raw.id,
    alias: raw.alias,
    teamId: raw.team_id,
    status: raw.status as TemplateStatus,
    vcpu: raw.vcpu ?? 0,
    memoryMib: raw.memory_mib ?? 0,
    diskMib: raw.disk_mib ?? 0,
    sizeBytes: raw.size_bytes,
    errorMessage: raw.error_message,
    createdAt: new Date(raw.created_at),
    builtAt: raw.built_at ? new Date(raw.built_at) : undefined,
    latestBuildId: latestBuildId ?? raw.latest_build_id,
  }
}

export function toTemplateBuildInfo(
  raw: ApiTemplateBuildResponse,
): TemplateBuildInfo {
  if (!raw.id) {
    throw new SandboxError("Invalid API response: missing build id")
  }
  if (!raw.template_id) {
    throw new SandboxError("Invalid API response: missing template_id")
  }
  if (!raw.status) {
    throw new SandboxError("Invalid API response: missing build status")
  }
  if (!raw.build_spec_hash) {
    throw new SandboxError("Invalid API response: missing build_spec_hash")
  }
  if (!raw.created_at) {
    throw new SandboxError("Invalid API response: missing created_at")
  }

  return {
    id: raw.id,
    templateId: raw.template_id,
    status: raw.status as TemplateBuildStatus,
    buildSpecHash: raw.build_spec_hash,
    errorMessage: raw.error_message,
    startedAt: raw.started_at ? new Date(raw.started_at) : undefined,
    finalizedAt: raw.finalized_at ? new Date(raw.finalized_at) : undefined,
    createdAt: new Date(raw.created_at),
  }
}

export function toBuildLogEvent(raw: ApiBuildLogEvent): BuildLogEvent {
  if (!raw.timestamp) {
    throw new SandboxError("Invalid log event: missing timestamp")
  }
  if (!raw.stream) {
    throw new SandboxError("Invalid log event: missing stream")
  }

  return {
    timestamp: new Date(raw.timestamp),
    stream: raw.stream as BuildLogStream,
    text: raw.text ?? "",
    finished: raw.finished,
    status: raw.status as BuildLogEvent["status"],
  }
}

/**
 * Pass-through for build steps since camelCase structure matches the API.
 * Kept as a function for future normalization (e.g. defaulting sudo).
 */
export function buildStepsToApi(steps: BuildStep[]): unknown[] {
  return [...steps]
}
