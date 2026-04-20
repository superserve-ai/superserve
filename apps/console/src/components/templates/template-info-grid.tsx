import type { TemplateResponse } from "@/lib/api/types"
import { formatTime } from "@/lib/format"
import { formatBytes } from "@/lib/sandbox-utils"
import { TemplateResources } from "./template-resources"

function InfoCell({
  label,
  children,
  title,
}: {
  label: string
  children: React.ReactNode
  title?: string
}) {
  return (
    <div className="border border-dashed border-border p-4">
      <div className="font-mono text-[10px] uppercase tracking-wide text-muted">
        {label}
      </div>
      <div className="mt-2" title={title}>
        {children}
      </div>
    </div>
  )
}

export function TemplateInfoGrid({ template }: { template: TemplateResponse }) {
  const built = template.built_at
    ? formatTime(new Date(template.built_at))
    : null
  const created = formatTime(new Date(template.created_at))

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <InfoCell label="Resources">
        <TemplateResources
          vcpu={template.vcpu}
          memoryMib={template.memory_mib}
          diskMib={template.disk_mib}
          className="text-sm text-foreground/80"
        />
      </InfoCell>

      <InfoCell label="Size">
        <span className="font-mono text-sm text-foreground/80 tabular-nums">
          {template.size_bytes != null ? formatBytes(template.size_bytes) : "—"}
        </span>
      </InfoCell>

      <InfoCell label="Created" title={created.absolute}>
        <span className="text-sm text-foreground/80">{created.relative}</span>
      </InfoCell>

      <InfoCell label="Last built" title={built?.absolute}>
        <span className="text-sm text-foreground/80">
          {built ? built.relative : "Never"}
        </span>
      </InfoCell>
    </div>
  )
}
