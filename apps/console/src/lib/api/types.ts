export type SandboxStatus = "active" | "paused" | "resuming" | "failed"

export interface NetworkConfig {
  allow_out?: string[]
  deny_out?: string[]
}

export interface SandboxListItem {
  id: string
  name: string
  status: SandboxStatus
  vcpu_count: number
  memory_mib: number
  snapshot_id?: string
  timeout_seconds?: number
  network?: NetworkConfig
  metadata: Record<string, string>
  created_at: string
}

export interface SandboxResponse extends SandboxListItem {
  access_token: string
}

export interface ResumeResponse {
  id: string
  status: "active"
  access_token: string
}

export interface CreateSandboxRequest {
  name: string
  /** Template UUID or alias to boot from. */
  from_template?: string
  from_snapshot?: string
  timeout_seconds?: number
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

export type TemplateStatus = "pending" | "building" | "ready" | "failed"

export type BuildStatus =
  | "pending"
  | "building"
  | "snapshotting"
  | "ready"
  | "failed"
  | "cancelled"

export interface BuildStepRun {
  run: string
}
export interface BuildStepCopy {
  copy: { src: string; dst: string }
}
export interface BuildStepEnv {
  env: { key: string; value: string }
}
export interface BuildStepWorkdir {
  workdir: string
}
export interface BuildStepUser {
  user: { name: string; sudo?: boolean }
}
export type BuildStep =
  | BuildStepRun
  | BuildStepCopy
  | BuildStepEnv
  | BuildStepWorkdir
  | BuildStepUser

export interface BuildSpec {
  from: string
  steps?: BuildStep[]
  start_cmd?: string
  ready_cmd?: string
}

export interface CreateTemplateRequest {
  alias: string
  vcpu?: number
  memory_mib?: number
  disk_mib?: number
  build_spec: BuildSpec
}

export interface CreateTemplateResponse {
  id: string
  team_id: string
  alias: string
  status: Exclude<TemplateStatus, "pending">
  vcpu: number
  memory_mib: number
  disk_mib: number
  created_at: string
  build_id: string
}

export interface TemplateResponse {
  id: string
  team_id: string
  alias: string
  status: TemplateStatus
  vcpu: number
  memory_mib: number
  disk_mib: number
  size_bytes?: number
  error_message?: string
  created_at: string
  built_at?: string
}

export interface TemplateBuildResponse {
  id: string
  template_id: string
  status: BuildStatus
  build_spec_hash: string
  error_message?: string
  started_at?: string
  finalized_at?: string
  created_at: string
}

export interface BuildLogEvent {
  timestamp: string
  stream: "stdout" | "stderr" | "system"
  text: string
  finished?: boolean
  status?: "ready" | "failed" | "cancelled"
}
