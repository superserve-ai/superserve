"use client"

import { useQuery } from "@tanstack/react-query"

import { type CatalogPlan, catalogPlansOf } from "@/lib/api/billing-v2"
import {
  type PricingVersion,
  pricingVersionOf,
} from "@/lib/api/pricing-version"
import { billingKeys } from "@/lib/api/query-keys"
import { getPublicBillingPlansAction } from "@/lib/billing/plans-actions"

import { useBillingContext } from "./use-billing-context"

function usePublicPlans<T = unknown>(select?: (body: unknown) => T) {
  const { cacheScope, teamKey, ready } = useBillingContext()
  return useQuery({
    queryKey: billingKeys.pricingVersion({
      cacheScope,
      teamKey: teamKey ?? "",
    }),
    queryFn: () => getPublicBillingPlansAction(teamKey?.split(":")[0]),
    select,
    enabled: ready && teamKey !== null,
    retry: false,
    staleTime: 60_000,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  })
}

export function usePricingVersionState(): PricingVersion | "unknown" {
  const query = usePublicPlans()
  if (query.isError) return "legacy"
  return query.data === undefined ? "unknown" : pricingVersionOf(query.data)
}

export function usePricingVersion(): PricingVersion | null | undefined {
  const query = usePublicPlans()
  if (query.isError) return null
  return query.data === undefined ? undefined : pricingVersionOf(query.data)
}

export function useCatalogPlans() {
  return usePublicPlans<CatalogPlan[]>(catalogPlansOf)
}
