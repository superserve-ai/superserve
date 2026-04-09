export type SandboxStatus = "active" | "pausing" | "idle" | "deleted" | "failed"

export interface NetworkConfig {
  allow_out?: string[]
  deny_out?: string[]
}

export interface SandboxResponse {
  id: string
  name: string
  status: SandboxStatus
  vcpu_count: number
  memory_mib: number
  snapshot_id?: string
  created_at: string
}

export interface CreateSandboxRequest {
  name: string
  from_snapshot?: string
  network?: NetworkConfig
}

export interface SandboxPatch {
  network?: NetworkConfig
}

export interface ExecRequest {
  command: string
  args?: string[]
  env?: Record<string, string>
  working_dir?: string
  timeout_s?: number
}

export interface ExecResult {
  stdout: string
  stderr: string
  exit_code: number
}

export interface ExecStreamEvent {
  timestamp: string
  stdout?: string
  stderr?: string
  exit_code?: number
  finished?: boolean
  error?: string
}

export interface ApiKeyResponse {
  id: string
  name: string
  prefix: string
  created_at: string
  last_used_at: string | null
}

export interface CreateApiKeyRequest {
  name: string
}

export interface CreateApiKeyResponse {
  id: string
  name: string
  key: string
  prefix: string
  created_at: string
}

export interface SnapshotResponse {
  id: string
  sandbox_id: string
  name: string | null
  size_bytes: number
  saved: boolean
  trigger: string
  created_at: string
}

export interface ActivityResponse {
  id: string
  sandbox_id: string
  category: string
  action: string
  status: string | null
  sandbox_name: string | null
  duration_ms: number | null
  error: string | null
  metadata: Record<string, unknown>
  created_at: string
}

export interface ApiError {
  error: {
    code: string
    message: string
  }
}

export interface HealthResponse {
  status: string
  version: string
}
