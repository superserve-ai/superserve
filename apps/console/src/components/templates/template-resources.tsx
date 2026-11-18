import { cn } from "@superserve/ui"

function formatMemory(mib: number): string {
  return mib >= 1024 ? `${mib / 1024} GB` : `${mib} MiB`
}

function formatDisk(mib: number): string {
  return mib >= 1024 ? `${mib / 1024} GB` : `${mib} MiB`
}

export function TemplateResources({
  vcpu,
  memoryMib,
  memoryMaxMib,
  vcpuMax,
  diskMib,
  className,
}: {
  vcpu: number
  memoryMib: number
  memoryMaxMib?: number
  vcpuMax?: number
  diskMib: number
  className?: string
}) {
  return (
    <span className={cn("font-mono text-xs text-muted", className)}>
      {vcpu}
      {vcpuMax != null && `–${vcpuMax}`} vCPU · {formatMemory(memoryMib)}
      {memoryMaxMib != null && `–${formatMemory(memoryMaxMib)}`} ·{" "}
      {formatDisk(diskMib)}
    </span>
  )
}
