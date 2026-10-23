"use client"

import { useQuery } from "@tanstack/react-query"

import {
  fetchPublicPlans,
  type PricingVersion,
  pricingVersionOf,
} from "@/lib/api/pricing-version"
import { billingKeys } from "@/lib/api/query-keys"

import { useBillingContext } from "./use-billing-context"

function usePublicPlans() {
  const { cacheScope, teamKey, ready } = useBillingContext()
  return useQuery({
    queryKey: billingKeys.pricingVersion({
      cacheScope,
      teamKey: teamKey ?? "",
    }),
    queryFn: fetchPublicPlans,
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
