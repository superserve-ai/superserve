"use client"

import {
  type UseQueryResult,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"

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
  { manualRecovery = false }: { manualRecovery?: boolean } = {},
): UseQueryResult<BillingSummaryResponse, Error> {
  const { cacheScope, teamKey, ready } = useBillingContext()

  const client = useQueryClient()
  const queryKey = billingKeys.summary({
    cacheScope,
    teamKey: teamKey ?? "unresolved",
  })
  const retry =
    client.getQueryDefaults(queryKey).retry ??
    client.getDefaultOptions().queries?.retry
  return useQuery<BillingSummaryResponse, Error>({
    queryKey,
    queryFn: getBillingSummary,
    retry: (count, error) => retryBillingUsageQuery(count, error, retry),
    enabled: enabled && ready,
    staleTime: 60_000,
    refetchInterval: (query) =>
      manualRecovery && isBillingUsageUnavailable(query.state.error)
        ? false
        : 60_000,
    refetchOnWindowFocus: (query) =>
      !manualRecovery || !isBillingUsageUnavailable(query.state.error),
    refetchIntervalInBackground: false,
  })
}
