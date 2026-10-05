"use client"

import { useQuery } from "@tanstack/react-query"

import { useBillingContext } from "@/hooks/use-billing-context"
import {
  getBillingPricing,
  getBillingUsageSeries,
  type BillingUsageGranularity,
} from "@/lib/api/billing"
import type { BillingUsageSeriesResponse } from "@/lib/api/billing"
import {
  getBillingUsageAction,
  type BillingUsageResponse,
} from "@/lib/api/billing-actions"
import { billingKeys } from "@/lib/api/query-keys"

const RECENT_USAGE_WINDOW_MS = 2 * 60 * 60 * 1000

function getLocalTimezone() {
  // Default bucket boundaries and cache identity to the browser timezone.
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

export function useBillingSettings() {
  const { cacheScope, teamKey, ready } = useBillingContext()

  return useQuery({
    queryKey:
      teamKey !== null
        ? billingKeys.settings({ cacheScope, teamKey })
        : billingKeys.settings({ cacheScope, teamKey: "unresolved" }),
    queryFn: getBillingPricing,
    enabled: ready,
    staleTime: 5 * 60_000,
  })
}

export function useBillingUsage(
  periodStart: Date,
  periodEnd: Date,
  granularityOrEnabled: BillingUsageGranularity | boolean = "daily",
  timezoneOrEnabled: string | boolean = getLocalTimezone(),
  enabledArg = true,
) {
  const legacySignature = typeof granularityOrEnabled === "boolean"
  const granularity = legacySignature ? "daily" : granularityOrEnabled
  const timezone =
    typeof timezoneOrEnabled === "string"
      ? timezoneOrEnabled
      : getLocalTimezone()
  const enabled =
    typeof granularityOrEnabled === "boolean"
      ? granularityOrEnabled
      : typeof timezoneOrEnabled === "boolean"
        ? timezoneOrEnabled
        : enabledArg
  const { cacheScope, teamKey, ready } = useBillingContext()
  const start = periodStart.toISOString()
  const end = periodEnd.toISOString()

  // oxlint-disable-next-line react/purity
  const overlapsRecentUsage =
    periodEnd.getTime() > Date.now() - RECENT_USAGE_WINDOW_MS

  return useQuery<BillingUsageResponse | BillingUsageSeriesResponse>({
    queryKey: legacySignature
      ? teamKey !== null
        ? billingKeys.usage({
            cacheScope,
            teamKey,
            periodStart: start,
            periodEnd: end,
          })
        : billingKeys.usage({
            cacheScope,
            teamKey: "unresolved",
            periodStart: start,
            periodEnd: end,
          })
      : teamKey !== null
        ? billingKeys.usageSeries({
            cacheScope,
            teamKey,
            start,
            end,
            granularity,
            timezone,
          })
        : billingKeys.usageSeries({
            cacheScope,
            teamKey: "unresolved",
            start,
            end,
            granularity,
            timezone,
          }),
    queryFn: legacySignature
      ? () => getBillingUsageAction(start, end)
      : () => getBillingUsageSeries({ start, end, granularity, timezone }),
    enabled: enabled && ready,
    staleTime: overlapsRecentUsage ? 30_000 : 30 * 60_000,
    refetchInterval: overlapsRecentUsage ? 60_000 : false,
    refetchIntervalInBackground: false,
  })
}
