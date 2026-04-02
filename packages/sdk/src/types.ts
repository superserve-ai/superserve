// ==================== Client Options ====================

export interface SuperserveOptions {
  /** API key for authentication. */
  apiKey: string
  /** Base URL for the API. Defaults to https://api.agentbox.dev */
  baseUrl?: string
  /** Request timeout in milliseconds. Defaults to 30000. */
  timeout?: number
}

// ==================== VM ====================

export type VmStatus = "CREATING" | "RUNNING" | "STOPPED" | "SLEEPING" | "DEAD"

export interface Vm {
  id: string
  name: string
  status: VmStatus
  vcpuCount: number
  memSizeMib: number
  ipAddress: string | null
  createdAt: string
  uptimeSeconds: number
  lastCheckpointAt: string | null
  parentVmId: string | null
  forkedFromCheckpointId: string | null
}

export interface CreateVmOptions {
  name: string
  image: string
  vcpuCount?: number
  memSizeMib?: number
}

// ==================== Exec ====================

export interface ExecOptions {
  command: string
  timeoutS?: number
}

export interface ExecResult {
  stdout: string
  stderr: string
  exitCode: number
}

export type ExecStreamEvent =
  | { type: "stdout"; data: string }
  | { type: "stderr"; data: string }
  | { type: "exit"; exitCode: number }

// ==================== Checkpoint ====================

export type CheckpointType = "auto" | "manual" | "named"

export interface Checkpoint {
  id: string
  vmId: string
  name: string | null
  type: CheckpointType
  sizeBytes: number
  deltaSizeBytes: number
  createdAt: string
  pinned: boolean
}

// ==================== Rollback ====================

export interface RollbackOptions {
  checkpointId?: string
  name?: string
  minutesAgo?: number
  preserveNewer?: boolean
}

// ==================== Fork ====================

export interface ForkOptions {
  count: number
  fromCheckpointId?: string
}

export interface ForkResult {
  sourceVmId: string
  checkpointId: string
  vms: Vm[]
}

export interface ForkTree {
  vmId: string
  name: string
  status: VmStatus
  forkedFromCheckpointId: string | null
  children: ForkTree[]
}

// ==================== Internal API types (snake_case wire format) ====================

/** @internal */
export interface ApiVm {
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

/** @internal */
export interface ApiCheckpoint {
  id: string
  vm_id: string
  name: string | null
  type: CheckpointType
  size_bytes: number
  delta_size_bytes: number
  created_at: string
  pinned: boolean
}

/** @internal */
export interface ApiExecResponse {
  stdout: string
  stderr: string
  exit_code: number
}

/** @internal */
export interface ApiForkResponse {
  source_vm_id: string
  checkpoint_id: string
  vms: ApiVm[]
}

/** @internal */
export interface ApiForkTree {
  vm_id: string
  name: string
  status: VmStatus
  forked_from_checkpoint_id: string | null
  children: ApiForkTree[]
}

/** @internal */
export interface ApiExecStreamEvent {
  stdout?: string
  stderr?: string
  timestamp?: string
  exit_code?: number
  finished?: boolean
}
