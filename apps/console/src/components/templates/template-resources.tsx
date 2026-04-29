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
  diskMib,
  className,
}: {
  vcpu: number
  memoryMib: number
  diskMib: number
  className?: string
}) {
  return (
    <span className={cn("font-mono text-xs text-muted", className)}>
      {vcpu} vCPU · {formatMemory(memoryMib)} · {formatDisk(diskMib)}
    </span>
  )
}
