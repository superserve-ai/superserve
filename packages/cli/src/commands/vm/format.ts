import pc from "picocolors"
import type { Vm, VmStatus } from "../../api/types"
import { formatElapsed, formatTimestamp } from "../../utils/format"

const STATUS_COLORS: Record<VmStatus, (s: string) => string> = {
  CREATING: pc.yellow,
  RUNNING: pc.green,
  STOPPED: pc.dim,
  SLEEPING: pc.blue,
  DEAD: pc.red,
}

export function coloredStatus(status: VmStatus): string {
  const colorFn = STATUS_COLORS[status] ?? pc.dim
  return colorFn(status)
}

export function formatVmDetail(vm: Vm): string {
  const lines = [
    `  ID:         ${pc.dim(vm.id)}`,
    `  Status:     ${coloredStatus(vm.status)}`,
    `  vCPU:       ${vm.vcpu_count}`,
    `  Memory:     ${vm.mem_size_mib} MiB`,
    `  IP:         ${vm.ip_address ?? pc.dim("pending")}`,
    `  Uptime:     ${formatElapsed(vm.uptime_seconds)}`,
    `  Created:    ${formatTimestamp(vm.created_at, true)}`,
  ]
  if (vm.last_checkpoint_at) {
    lines.push(`  Last CP:    ${formatTimestamp(vm.last_checkpoint_at, true)}`)
  }
  if (vm.parent_vm_id) {
    lines.push(`  Parent:     ${pc.dim(vm.parent_vm_id)}`)
  }
  return lines.join("\n")
}
