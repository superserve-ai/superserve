// ==================== AUTH ====================

export interface Credentials {
  api_key: string
}

// ==================== VMs ====================

export type VmStatus = "CREATING" | "RUNNING" | "STOPPED" | "SLEEPING" | "DEAD"

export interface Vm {
  id: string
  name: string
  status: VmStatus
  vcpu_count: number
  mem_size_mib: number
  ip_address: string | null
  created_at: string
  uptime_seconds: number
  last_checkpoint_at: string | null
  parent_vm_id: string | null
  forked_from_checkpoint_id: string | null
}

export interface CreateVmRequest {
  name: string
  image: string
  vcpu_count?: number
  mem_size_mib?: number
}

// ==================== EXEC ====================

export interface ExecRequest {
  command: string
  timeout_s?: number
}

export interface ExecResponse {
  stdout: string
  stderr: string
  exit_code: number
}

export interface ExecStreamEvent {
  stdout?: string
  stderr?: string
  timestamp?: string
  exit_code?: number
  finished?: boolean
}

// ==================== FILES ====================

// Files use raw binary request/response bodies, no specific types needed.

// ==================== CHECKPOINTS ====================

export type CheckpointType = "auto" | "manual" | "named"

export interface Checkpoint {
  id: string
  vm_id: string
  name: string | null
  type: CheckpointType
  size_bytes: number
  delta_size_bytes: number
  created_at: string
  pinned: boolean
}

export interface CreateCheckpointRequest {
  name: string
}

// ==================== ROLLBACK ====================

export interface RollbackRequest {
  checkpoint_id?: string
  name?: string
  minutes_ago?: number
  preserve_newer?: boolean
}

// ==================== FORK ====================

export interface ForkRequest {
  count: number
  from_checkpoint_id?: string
}

export interface ForkResponse {
  source_vm_id: string
  checkpoint_id: string
  vms: Vm[]
}

export interface ForkTree {
  vm_id: string
  name: string
  status: VmStatus
  forked_from_checkpoint_id: string | null
  children: ForkTree[]
}

// ==================== ERROR ====================

export interface ApiErrorResponse {
  error: {
    code: string
    message: string
    details?: Record<string, unknown>
  }
}
