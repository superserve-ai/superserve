"use client"

import { Badge, TableCell } from "@superserve/ui"

import { AnimatedTableRow } from "@/components/animated-table-row"
import type { SecretResponse } from "@/lib/api/types"
import { formatTime } from "@/lib/format"

import { AUTH_TYPE_LABEL } from "./auth-type-label"

export function SecretTableRow({
  secret,
  providerDisplay,
}: {
  secret: SecretResponse
  providerDisplay?: string
}) {
  const created = formatTime(new Date(secret.created_at))
  const lastUsed = secret.last_used_at
    ? formatTime(new Date(secret.last_used_at))
    : null
  const hosts = secret.hosts.join(", ")

  return (
    <AnimatedTableRow>
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
    </AnimatedTableRow>
  )
}
