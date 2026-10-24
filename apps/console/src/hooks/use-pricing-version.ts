"use client"

import { useQuery } from "@tanstack/react-query"

import { useBillingContext } from "@/hooks/use-billing-context"
import { catalogPlansOf, type CatalogPlan } from "@/lib/api/billing-v2"
import { billingKeys } from "@/lib/api/query-keys"
import type { PricingVersion, PublicBillingPlans } from "@/lib/billing/plans"
import { getPublicBillingPlansAction } from "@/lib/billing/plans-actions"

function usePublicPlans<T>(select: (plans: PublicBillingPlans) => T) {
  const { cacheScope, teamKey, ready } = useBillingContext()
  const query = useQuery({
    queryKey: billingKeys.pricingVersion({
      cacheScope,
      teamKey: teamKey ?? "unresolved",
    }),
    queryFn: () => getPublicBillingPlansAction(teamKey?.split(":")[0]),
    select,
    enabled: ready && teamKey !== null,
    retry: false,
    staleTime: 60_000,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  })
  return { ...query, data: query.isError ? undefined : query.data }
}

export function usePricingVersion(): PricingVersion | null | undefined {
  const query = usePublicPlans((plans) => plans.pricing_version)
  if (query.isError) return null
  return query.data
}

export function usePricingVersionState(): PricingVersion | "unknown" {
  const version = usePricingVersion()
  return version === undefined ? "unknown" : (version ?? "legacy")
}

export function useCatalogPlans() {
  return usePublicPlans<CatalogPlan[]>(catalogPlansOf)
}
