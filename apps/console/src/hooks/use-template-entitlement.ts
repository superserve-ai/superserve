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
  return { status, retry: query.refetch }
}
