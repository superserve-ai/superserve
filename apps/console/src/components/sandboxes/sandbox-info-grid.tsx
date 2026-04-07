import { CopyIcon } from "@phosphor-icons/react"
import { useToast } from "@superserve/ui"
import type { SandboxResponse } from "@/lib/api/types"
import { formatDate } from "@/lib/format"

interface SandboxInfoGridProps {
  sandbox: SandboxResponse
}

export function SandboxInfoGrid({ sandbox }: SandboxInfoGridProps) {
  const { addToast } = useToast()

  const handleCopyIp = async () => {
    if (!sandbox.ip_address) return
    await navigator.clipboard.writeText(sandbox.ip_address)
    addToast("Copied to clipboard", "success")
  }

  return (
    <div className="grid grid-cols-4 border-b border-border">
      <div className="border-r border-border px-4 py-4">
        <p className="text-xs text-muted">Resources</p>
        <p className="mt-2 text-sm text-foreground/80 tabular-nums">
          {sandbox.vcpu_count} vCPU &middot; {sandbox.memory_mib} MB
        </p>
      </div>
      <div className="border-r border-border px-4 py-4">
        <p className="text-xs text-muted">IP Address</p>
        <div className="mt-2 flex items-center gap-1.5">
          <p className="font-mono text-sm text-foreground/80">
            {sandbox.ip_address ?? "Not assigned"}
          </p>
          {sandbox.ip_address && (
            <button
              type="button"
              onClick={handleCopyIp}
              className="text-muted hover:text-foreground"
              aria-label="Copy IP address"
            >
              <CopyIcon className="size-3.5" weight="light" />
            </button>
          )}
        </div>
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
