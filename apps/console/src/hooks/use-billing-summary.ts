"use client"

import { type UseQueryResult, useQuery } from "@tanstack/react-query"

import {
  isBillingUsageUnavailable,
  retryBillingUsageQuery,
} from "@/hooks/billing-query-retry"
import { useBillingContext } from "@/hooks/use-billing-context"
import {
  getBillingSummary,
  type BillingSummaryResponse,
} from "@/lib/api/billing"
import { billingKeys } from "@/lib/api/query-keys"

export function useBillingSummary(
  enabled = true,
): UseQueryResult<BillingSummaryResponse, Error> {
  const { cacheScope, teamKey, ready } = useBillingContext()

  return useQuery<BillingSummaryResponse, Error>({
    queryKey:
      teamKey !== null
        ? billingKeys.summary({ cacheScope, teamKey })
        : billingKeys.summary({ cacheScope, teamKey: "unresolved" }),
    queryFn: getBillingSummary,
    retry: retryBillingUsageQuery,
    enabled: enabled && ready,
    staleTime: 60_000,
    refetchInterval: (query) =>
      isBillingUsageUnavailable(query.state.error) ? false : 60_000,
    refetchOnWindowFocus: (query) =>
      !isBillingUsageUnavailable(query.state.error),
    refetchIntervalInBackground: false,
  })
}
