import type { SandboxResponse } from "@/lib/api/types"
import { formatDate } from "@/lib/format"

interface SandboxInfoGridProps {
  sandbox: SandboxResponse
}

export function SandboxInfoGrid({ sandbox }: SandboxInfoGridProps) {
  return (
    <div className="grid grid-cols-3 border-b border-border">
      <div className="border-r border-border px-4 py-4">
        <p className="text-xs text-muted">Resources</p>
        <p className="mt-2 text-sm text-foreground/80 tabular-nums">
          {sandbox.vcpu_count} vCPU &middot; {sandbox.memory_mib} MB
        </p>
      </div>
      <div className="border-r border-border px-4 py-4">
        <p className="text-xs text-muted">Snapshot</p>
        <p className="mt-2 font-mono text-sm text-foreground/80">
          {sandbox.snapshot_id
            ? `${sandbox.snapshot_id.slice(0, 12)}...`
            : "None"}
        </p>
      </div>
      <div className="px-4 py-4">
        <p className="text-xs text-muted">Created</p>
        <p className="mt-2 text-sm text-foreground/80 tabular-nums">
          {formatDate(new Date(sandbox.created_at))}
        </p>
      </div>
    </div>
  )
}
