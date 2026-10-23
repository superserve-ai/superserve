"use client"

import { type UseQueryResult, useQuery } from "@tanstack/react-query"

import { useBillingContext } from "@/hooks/use-billing-context"
import { getPrepaidCredit, type PrepaidCreditSummary } from "@/lib/api/prepaid"
import { billingKeys } from "@/lib/api/query-keys"

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
      query.state.data?.purchases.some((p) => p.state === "pending") ||
      query.state.data?.auto_recharge.in_flight
        ? 5_000
        : 60_000,
    refetchIntervalInBackground: false,
  })
}
