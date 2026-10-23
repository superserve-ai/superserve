"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"

import { type CatalogPlan, catalogPlansOf } from "@/lib/api/billing-v2"
import {
  fetchPublicPlans,
  type PricingVersion,
  pricingVersionOf,
} from "@/lib/api/pricing-version"
import { billingKeys } from "@/lib/api/query-keys"

import { useBillingContext } from "./use-billing-context"

function usePublicPlans<T = unknown>(select?: (body: unknown) => T) {
  const { cacheScope, teamKey, ready } = useBillingContext()
  const queryClient = useQueryClient()
  const queryKey = billingKeys.pricingVersion({
    cacheScope,
    teamKey: teamKey ?? "",
  })
  return useQuery({
    queryKey,
    queryFn: () => fetchPublicPlans(queryClient.getQueryData(queryKey)),
    select,
    enabled: ready && teamKey !== null,
    retry: false,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  })
}

export function usePricingVersionState(): PricingVersion | "unknown" {
  const query = usePublicPlans()
  if (query.data !== undefined) return pricingVersionOf(query.data)
  return query.isError ? "legacy" : "unknown"
}

export function usePricingVersion(): PricingVersion {
  return usePricingVersionState() === "v2" ? "v2" : "legacy"
}

export function useCatalogPlans() {
  return usePublicPlans<CatalogPlan[]>(catalogPlansOf)
}
