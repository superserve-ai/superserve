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
  template_id?: string
  snapshot_id?: string
  access_token: string
  timeout?: number
  env_vars?: Record<string, string>
  network?: NetworkConfig
  metadata: Record<string, string>
  created_at: string
}

export interface CreateSandboxRequest {
  name: string
  template_id?: string
  from_snapshot?: string
  timeout?: number
  env_vars?: Record<string, string>
  metadata?: Record<string, string>
  network?: NetworkConfig
}

export interface SandboxPatch {
  network?: NetworkConfig
  metadata?: Record<string, string>
}

export interface ApiKeyResponse {
  id: string
  name: string
  prefix: string
  created_at: string
  last_used_at: string | null
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
