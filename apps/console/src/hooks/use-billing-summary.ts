"use client"

import { type UseQueryResult, useQuery } from "@tanstack/react-query"

import {
  getBillingSummary,
  type BillingSummaryResponse,
} from "@/lib/api/billing"
import { billingKeys } from "@/lib/api/query-keys"

export function useBillingSummary(
  enabled = true,
): UseQueryResult<BillingSummaryResponse, Error> {
  return useQuery<BillingSummaryResponse, Error>({
    queryKey: billingKeys.summary(),
    queryFn: getBillingSummary,
    enabled,
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  })
}
