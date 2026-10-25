"use client"

import { useQuery } from "@tanstack/react-query"

import { billingKeys } from "@/lib/api/query-keys"
import type { PublicBillingPlans } from "@/lib/billing/plans"
import { getPublicBillingPlansAction } from "@/lib/billing/plans-actions"

import { useBillingContext } from "./use-billing-context"

export function usePublicBillingPlans<T = PublicBillingPlans>(
  region?: string,
  enabled = true,
  select?: (body: PublicBillingPlans) => T,
) {
  const { cacheScope, teamKey, ready } = useBillingContext()
  return useQuery<PublicBillingPlans, Error, T>({
    queryKey: billingKeys.pricingVersion({
      cacheScope,
      teamKey: teamKey ?? "",
    }),
    queryFn: () => getPublicBillingPlansAction(teamKey?.split(":")[0]),
    select,
    enabled:
      enabled &&
      ready &&
      teamKey !== null &&
      (!region || teamKey.split(":")[0] === region),
    retry: false,
    staleTime: 60_000,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  })
}
