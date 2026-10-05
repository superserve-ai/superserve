import type { BadgeVariant } from "@superserve/ui"
import { Badge } from "@superserve/ui"

import type { SnapshotStatus } from "@/lib/api/types"
import { formatBytes } from "@/lib/sandbox-utils"

const VARIANT: Record<SnapshotStatus, BadgeVariant> = {
  creating: "warning",
  ready: "success",
  failed: "destructive",
  deleting: "warning",
}

const LABEL: Record<SnapshotStatus, string> = {
  creating: "Creating",
  ready: "Ready",
  failed: "Failed",
  deleting: "Deleting",
}

export function SnapshotStatusBadge({ status }: { status: SnapshotStatus }) {
  return (
    <Badge variant={VARIANT[status]} dot>
      {LABEL[status]}
    </Badge>
  )
}

/** The snapshot's size, or a dash until it is ready and the size is known. */
export function snapshotSize(snapshot: {
  status: SnapshotStatus
  size_bytes: number
}): string {
  return snapshot.status === "ready" ? formatBytes(snapshot.size_bytes) : "—"
}

/** The snapshot's name, or its short id when unnamed. */
export function snapshotLabel(snapshot: {
  id: string
  name: string | null
}): string {
  return snapshot.name ?? snapshot.id.slice(0, 8)
}
