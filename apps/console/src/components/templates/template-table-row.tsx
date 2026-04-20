"use client"

import { RocketLaunchIcon } from "@phosphor-icons/react"
import { Button, TableCell } from "@superserve/ui"
import { useRouter } from "next/navigation"
import { AnimatedTableRow } from "@/components/animated-table-row"
import type { TemplateResponse } from "@/lib/api/types"
import { formatTime } from "@/lib/format"
import { formatBytes } from "@/lib/sandbox-utils"
import { TemplateResources } from "./template-resources"
import { TemplateRowActions } from "./template-row-actions"
import { TemplateStatusBadge } from "./template-status-badge"

export function TemplateTableRow({ template }: { template: TemplateResponse }) {
  const router = useRouter()

  const handleLaunch = (t: TemplateResponse) => {
    router.push(`/sandboxes?from_template=${encodeURIComponent(t.alias)}`)
  }

  const handleRowClick = (e: React.MouseEvent) => {
    // Don't navigate if the click was on an interactive child (menu, button).
    const target = e.target as HTMLElement
    if (target.closest("button, [role='menuitem']")) return
    router.push(`/templates/${template.id}`)
  }

  const built = template.built_at
    ? formatTime(new Date(template.built_at))
    : null
  const canLaunch = template.status === "ready"

  return (
    <AnimatedTableRow onClick={handleRowClick} className="cursor-pointer">
      <TableCell className="font-mono text-foreground/80">
        {template.alias}
      </TableCell>
      <TableCell>
        <TemplateStatusBadge status={template.status} />
      </TableCell>
      <TableCell>
        <TemplateResources
          vcpu={template.vcpu}
          memoryMib={template.memory_mib}
          diskMib={template.disk_mib}
        />
      </TableCell>
      <TableCell className="font-mono text-xs text-muted tabular-nums">
        {template.size_bytes != null ? formatBytes(template.size_bytes) : "—"}
      </TableCell>
      <TableCell
        className="text-xs text-muted tabular-nums"
        title={built?.absolute}
      >
        {built ? built.relative : "Never"}
      </TableCell>
      <TableCell onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="outline"
            size="sm"
            className="text-xs"
            disabled={!canLaunch}
            onClick={() => handleLaunch(template)}
          >
            <RocketLaunchIcon className="size-3.5" weight="light" />
            Launch
          </Button>
          <TemplateRowActions template={template} onLaunch={handleLaunch} />
        </div>
      </TableCell>
    </AnimatedTableRow>
  )
}
