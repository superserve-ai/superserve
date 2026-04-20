import type { TemplateResponse } from "@/lib/api/types"
import { formatTime } from "@/lib/format"
import { formatBytes } from "@/lib/sandbox-utils"

function formatMemory(mib: number): string {
  return mib >= 1024 ? `${mib / 1024} GB` : `${mib} MiB`
}

export function TemplateInfoGrid({ template }: { template: TemplateResponse }) {
  const built = template.built_at
    ? formatTime(new Date(template.built_at))
    : null
  const created = formatTime(new Date(template.created_at))

  return (
    <div className="border-b border-border">
      <div className="grid grid-cols-4">
        <div className="border-r border-border px-4 py-4">
          <p className="text-xs text-muted">Resources</p>
          <p className="mt-2 font-mono text-sm text-foreground/80 tabular-nums">
            {template.vcpu} vCPU &middot; {formatMemory(template.memory_mib)}
            &nbsp;&middot; {formatMemory(template.disk_mib)}
          </p>
        </div>
        <div className="border-r border-border px-4 py-4">
          <p className="text-xs text-muted">Size</p>
          <p className="mt-2 font-mono text-sm text-foreground/80 tabular-nums">
            {template.size_bytes != null
              ? formatBytes(template.size_bytes)
              : "—"}
          </p>
        </div>
        <div
          className="border-r border-border px-4 py-4"
          title={created.absolute}
        >
          <p className="text-xs text-muted">Created</p>
          <p className="mt-2 text-sm text-foreground/80 tabular-nums">
            {created.relative}
          </p>
        </div>
        <div className="px-4 py-4" title={built?.absolute}>
          <p className="text-xs text-muted">Last built</p>
          <p className="mt-2 text-sm text-foreground/80 tabular-nums">
            {built ? built.relative : "Never"}
          </p>
        </div>
      </div>
    </div>
  )
}
