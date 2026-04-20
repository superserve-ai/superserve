import type { BadgeVariant } from "@superserve/ui"
import { Badge } from "@superserve/ui"
import type { BuildStatus, TemplateStatus } from "@/lib/api/types"

type Status = TemplateStatus | BuildStatus

const VARIANT: Record<Status, BadgeVariant> = {
  pending: "muted",
  building: "warning",
  snapshotting: "warning",
  ready: "success",
  failed: "destructive",
  cancelled: "muted",
}

const LABEL: Record<Status, string> = {
  pending: "Pending",
  building: "Building",
  snapshotting: "Snapshotting",
  ready: "Ready",
  failed: "Failed",
  cancelled: "Cancelled",
}

export function TemplateStatusBadge({ status }: { status: Status }) {
  return (
    <Badge variant={VARIANT[status]} dot>
      {LABEL[status]}
    </Badge>
  )
}
