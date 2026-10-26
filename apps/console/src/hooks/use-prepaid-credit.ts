"use client"

import { type UseQueryResult, useQuery } from "@tanstack/react-query"
import { useEffect, useState } from "react"

import { useBillingContext } from "@/hooks/use-billing-context"
import {
  getPrepaidCredit,
  type PrepaidCreditSummary,
  type PrepaidPurchase,
  type PrepaidOperation,
  reconcilePrepaidOperations,
  retainedPrepaidOperations,
  PREPAID_OPERATIONS_CHANGED,
} from "@/lib/api/prepaid"
import { billingKeys } from "@/lib/api/query-keys"

import { useUser } from "./use-user"

export function usePrepaidCredit(
  enabled = true,
): UseQueryResult<PrepaidCreditSummary, Error> {
  const { cacheScope, teamKey, ready } = useBillingContext()
  return useQuery<PrepaidCreditSummary, Error>({
    queryKey: billingKeys.prepaid({
      cacheScope,
      teamKey: teamKey ?? "unresolved",
    }),
    queryFn: getPrepaidCredit,
    enabled: enabled && ready,
    staleTime: 15_000,
    refetchInterval: (query) =>
      query.state.data?.purchases.some(
        (p) => p.state === "pending" || p.state === "paid",
      ) || query.state.data?.auto_recharge.in_flight
        ? 5_000
        : 60_000,
    refetchIntervalInBackground: false,
  })
}

export function useRetainedPrepaidOperations(purchases?: PrepaidPurchase[]) {
  const actor = useUser().user?.id
  const { teamKey } = useBillingContext()
  const [saved, setSaved] = useState<{
    actor: string
    team: string
    operations: PrepaidOperation[]
  } | null>(null)
  useEffect(() => {
    const refresh = () => {
      if (!actor || !teamKey) return
      try {
        if (purchases) reconcilePrepaidOperations(actor, teamKey, purchases)
        setSaved({
          actor,
          team: teamKey,
          operations: retainedPrepaidOperations(actor, teamKey),
        })
      } catch {
        setSaved(null)
      }
    }
    refresh()
    window.addEventListener(PREPAID_OPERATIONS_CHANGED, refresh)
    return () => window.removeEventListener(PREPAID_OPERATIONS_CHANGED, refresh)
  }, [actor, teamKey, purchases])

  return saved?.actor === actor && saved?.team === teamKey
    ? saved.operations
    : []
}
