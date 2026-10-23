"use client"

import { useQuery } from "@tanstack/react-query"

import { useBillingContext } from "@/hooks/use-billing-context"
import type { PricingVersion } from "@/lib/billing/plans"
import { getPublicBillingPlansAction } from "@/lib/billing/plans-actions"

export function usePricingVersion(): PricingVersion | null | undefined {
  const { cacheScope, teamKey, ready } = useBillingContext()
  const { data, isError } = useQuery({
    queryKey: [
      "billing",
      "pricing-version",
      cacheScope,
      teamKey ?? "unresolved",
    ],
    queryFn: async () =>
      (await getPublicBillingPlansAction(teamKey?.split(":")[0]))
        .pricing_version,
    enabled: ready,
    staleTime: 60_000,
  })
  if (!data) return isError ? null : undefined
  return data
}
