"use client"

import { useQuery } from "@tanstack/react-query"

import {
  getBillingSettingsAction,
  getBillingUsageAction,
} from "@/lib/api/billing-actions"
import { billingKeys } from "@/lib/api/query-keys"

const RECENT_USAGE_WINDOW_MS = 2 * 60 * 60 * 1000

export function useBillingSettings() {
  return useQuery({
    queryKey: billingKeys.settings(),
    queryFn: getBillingSettingsAction,
    staleTime: 5 * 60_000,
  })
}

export function useBillingUsage(
  periodStart: Date,
  periodEnd: Date,
  enabled = true,
) {
  const start = periodStart.toISOString()
  const end = periodEnd.toISOString()

  const overlapsRecentUsage =
    periodEnd.getTime() > Date.now() - RECENT_USAGE_WINDOW_MS

  return useQuery({
    queryKey: billingKeys.usage({ periodStart: start, periodEnd: end }),
    queryFn: () => getBillingUsageAction(start, end),
    enabled,
    staleTime: overlapsRecentUsage ? 30_000 : 30 * 60_000,
    refetchInterval: overlapsRecentUsage ? 60_000 : false,
    refetchIntervalInBackground: false,
  })
}
