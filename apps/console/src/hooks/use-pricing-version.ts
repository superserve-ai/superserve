"use client"

import { useQuery } from "@tanstack/react-query"

import {
  fetchPricingVersion,
  type PricingVersion,
} from "@/lib/api/pricing-version"
import { billingKeys } from "@/lib/api/query-keys"

import { useBillingContext } from "./use-billing-context"

export function usePricingVersion(): PricingVersion {
  const { cacheScope, teamKey, ready } = useBillingContext()
  const query = useQuery({
    queryKey: billingKeys.pricingVersion({
      cacheScope,
      teamKey: teamKey ?? "",
    }),
    queryFn: fetchPricingVersion,
    enabled: ready && teamKey !== null,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  })
  return query.data ?? "legacy"
}
