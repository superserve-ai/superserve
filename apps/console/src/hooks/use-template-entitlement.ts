"use client"

import { useBillingContext } from "./use-billing-context"
import { useTeamPlan } from "./use-billing-v2"

export function useTemplateEntitlement() {
  const context = useBillingContext()
  const query = useTeamPlan(context.ready)
  const status =
    !context.ready || context.teamKey === null
      ? "loading"
      : query.isError
        ? "error"
        : !query.isSuccess || query.data === undefined
          ? "loading"
          : query.data?.limits.max_templates === 0
            ? "unavailable"
            : "allowed"
  // The plan's per-sandbox caps, so the create dialog only offers shapes the
  // backend would accept for this team. Absent while loading or for teams
  // whose plan reports no cap.
  const limits = query.isSuccess ? (query.data?.limits ?? null) : null
  return { status, retry: query.refetch, limits }
}
