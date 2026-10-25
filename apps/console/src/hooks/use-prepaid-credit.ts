"use client"

import { useQuery } from "@tanstack/react-query"

import { useBillingContext } from "@/hooks/use-billing-context"
import { getPrepaidCredit, type PrepaidCreditSummary } from "@/lib/api/prepaid"
import { billingKeys } from "@/lib/api/query-keys"

export function usePrepaidCredit(enabled = true) {
  const { cacheScope, teamKey, ready } = useBillingContext()
  const query = useQuery<PrepaidCreditSummary, Error>({
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
  return { ...query, data: query.isError ? undefined : query.data }
}
