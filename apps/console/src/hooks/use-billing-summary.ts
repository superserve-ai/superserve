"use client"

import { useQuery } from "@tanstack/react-query"

import { getBillingSummary } from "@/lib/api/billing"
import { billingKeys } from "@/lib/api/query-keys"

export function useBillingSummary(enabled = true) {
  return useQuery({
    queryKey: billingKeys.summary(),
    queryFn: getBillingSummary,
    enabled,
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  })
}
