import { Badge } from "@superserve/ui"
import type { SandboxResponse } from "@/lib/api/types"
import { formatDate } from "@/lib/format"

interface SandboxInfoGridProps {
  sandbox: SandboxResponse
}

function formatTimeout(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`
  return `${Math.floor(seconds / 86400)}d`
}

export function SandboxInfoGrid({ sandbox }: SandboxInfoGridProps) {
  const metadataEntries = Object.entries(sandbox.metadata ?? {})
  const hasNetwork =
    sandbox.network?.allow_out?.length || sandbox.network?.deny_out?.length

  return (
    <div className="border-b border-border">
      <div className="grid grid-cols-4 border-b border-border">
        <div className="border-r border-border px-4 py-4">
          <p className="text-xs text-muted">Resources</p>
          <p className="mt-2 text-sm text-foreground/80 tabular-nums">
            {sandbox.vcpu_count} vCPU &middot; {sandbox.memory_mib} MB
          </p>
        </div>
        <div className="border-r border-border px-4 py-4">
          <p className="text-xs text-muted">Timeout</p>
          <p className="mt-2 font-mono text-sm text-foreground/80">
            {sandbox.timeout ? formatTimeout(sandbox.timeout) : "None"}
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

      {hasNetwork && (
        <div className="border-b border-border px-4 py-4">
          <p className="mb-2 text-xs text-muted">Network</p>
          <div className="flex flex-wrap gap-1.5">
            {sandbox.network?.allow_out?.map((rule) => (
              <Badge key={`allow-${rule}`} variant="success">
                allow {rule}
              </Badge>
            ))}
            {sandbox.network?.deny_out?.map((rule) => (
              <Badge key={`deny-${rule}`} variant="destructive">
                deny {rule}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {metadataEntries.length > 0 && (
        <div className="px-4 py-4">
          <p className="mb-2 text-xs text-muted">Metadata</p>
          <div className="flex flex-wrap gap-1.5">
            {metadataEntries.map(([key, value]) => (
              <Badge key={key} variant="muted">
                {key}: {value}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
