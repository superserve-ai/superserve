"use client"

import { useQuery } from "@tanstack/react-query"

import { getBillingUsageAction } from "@/lib/api/billing-actions"
import { billingKeys } from "@/lib/api/query-keys"

export function useBillingUsage(periodStart: Date, periodEnd: Date) {
  const start = periodStart.toISOString()
  const end = periodEnd.toISOString()

  return useQuery({
    queryKey: billingKeys.usage({ periodStart: start, periodEnd: end }),
    queryFn: () => getBillingUsageAction(start, end),
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  })
}
