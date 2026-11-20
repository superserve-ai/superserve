"use client"

import { useBillingContext } from "./use-billing-context"
import { useTeamEffectiveLimits } from "./use-billing-v2"

export function useTemplateEntitlement() {
  const context = useBillingContext()
  const query = useTeamEffectiveLimits(context.ready)
  const status =
    !context.ready || context.teamKey === null
      ? "loading"
      : query.isError
        ? "error"
        : !query.isSuccess || query.data === undefined
          ? "loading"
          : query.data?.max_templates === 0
            ? "unavailable"
            : "allowed"
  const limits = query.isSuccess ? (query.data ?? null) : null
  return { status, retry: query.refetch, limits }
}
