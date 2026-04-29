"use client"

import { RocketLaunchIcon } from "@phosphor-icons/react"
import { Badge, Button, TableCell } from "@superserve/ui"
import { useRouter } from "next/navigation"
import { AnimatedTableRow } from "@/components/animated-table-row"
import type { TemplateResponse } from "@/lib/api/types"
import { formatTime } from "@/lib/format"
import { isSystemTemplate } from "@/lib/templates/is-system-template"
import { TemplateResources } from "./template-resources"
import { TemplateRowActions } from "./template-row-actions"
import { TemplateStatusBadge } from "./template-status-badge"

export function TemplateTableRow({ template }: { template: TemplateResponse }) {
  const router = useRouter()
  const system = isSystemTemplate(template)

  const handleLaunch = (t: TemplateResponse) => {
    router.push(`/sandboxes?from_template=${encodeURIComponent(t.alias)}`)
  }

  const handleRowClick = (e: React.MouseEvent) => {
    // Don't navigate if the click was on an interactive child (menu, button).
    const target = e.target as HTMLElement
    if (target.closest("button, [role='menuitem']")) return
    router.push(`/templates/${template.id}`)
  }

  const created = formatTime(new Date(template.created_at))
  const updated = template.built_at
    ? formatTime(new Date(template.built_at))
    : null
  const canLaunch = template.status === "ready"

  return (
    <AnimatedTableRow onClick={handleRowClick} className="cursor-pointer">
      <TableCell>
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="font-mono text-foreground/80">
              {template.alias}
            </span>
            {system && <Badge variant="muted">System</Badge>}
          </div>
          <span
            className="font-mono text-[10px] text-muted tabular-nums"
            title={template.id}
          >
            {template.id.slice(0, 8)}
          </span>
        </div>
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
      <TableCell
        className="text-xs text-muted tabular-nums"
        title={created.absolute}
      >
        {created.relative}
      </TableCell>
      <TableCell
        className="text-xs text-muted tabular-nums"
        title={updated?.absolute}
      >
        {updated ? updated.relative : "—"}
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
          <TemplateRowActions
            template={template}
            isSystem={system}
            onLaunch={handleLaunch}
          />
        </div>
      </TableCell>
    </AnimatedTableRow>
  )
}
