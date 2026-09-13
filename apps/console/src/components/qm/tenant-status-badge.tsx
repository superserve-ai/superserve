import { Badge } from "@superserve/ui"

import type { QmTenantStatus } from "@/lib/api/types"
import { QM_STATUS_BADGE_VARIANT, QM_STATUS_LABEL } from "@/lib/qm/options"

export function TenantStatusBadge({ status }: { status: QmTenantStatus }) {
  return (
    <Badge variant={QM_STATUS_BADGE_VARIANT[status]} dot>
      {QM_STATUS_LABEL[status]}
    </Badge>
  )
}
