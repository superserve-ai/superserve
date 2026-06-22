"use client"

import { Badge, TableCell } from "@superserve/ui"
import { useRouter } from "next/navigation"

import { AnimatedTableRow } from "@/components/animated-table-row"
import type { SecretResponse } from "@/lib/api/types"
import { formatTime } from "@/lib/format"

import { AUTH_TYPE_LABEL } from "./auth-type-label"
import { SecretRowActions } from "./secret-row-actions"

export function SecretTableRow({
  secret,
  providerDisplay,
}: {
  secret: SecretResponse
  providerDisplay?: string
}) {
  const router = useRouter()

  const handleRowClick = (e: React.MouseEvent) => {
    // Don't navigate if the click was on an interactive child (menu, button).
    const target = e.target as HTMLElement
    if (target.closest("button, [role='menuitem']")) return
    router.push(`/secrets/${secret.name}`)
  }

  const created = formatTime(new Date(secret.created_at))
  const lastUsed = secret.last_used_at
    ? formatTime(new Date(secret.last_used_at))
    : null
  const hosts = secret.hosts.join(", ")

  return (
    <AnimatedTableRow onClick={handleRowClick} className="cursor-pointer">
      <TableCell className="font-mono text-foreground/80">
        {secret.name}
      </TableCell>
      <TableCell>
        {providerDisplay ?? secret.provider_shortcut ?? (
          <span className="text-muted">Custom</span>
        )}
      </TableCell>
      <TableCell>
        <Badge variant="muted">{AUTH_TYPE_LABEL[secret.auth_type]}</Badge>
      </TableCell>
      <TableCell
        className="max-w-[240px] truncate font-mono text-xs text-muted"
        title={hosts}
      >
        {hosts}
      </TableCell>
      <TableCell
        className="text-xs text-muted tabular-nums"
        title={lastUsed?.absolute}
      >
        {lastUsed ? lastUsed.relative : "Never"}
      </TableCell>
      <TableCell
        className="text-xs text-muted tabular-nums"
        title={created.absolute}
      >
        {created.relative}
      </TableCell>
      <TableCell onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-end">
          <SecretRowActions secret={secret} />
        </div>
      </TableCell>
    </AnimatedTableRow>
  )
}
