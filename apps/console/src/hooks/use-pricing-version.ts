"use client"

import { useQuery } from "@tanstack/react-query"

import { useBillingContext } from "@/hooks/use-billing-context"
import { apiClient } from "@/lib/api/client"

export type PricingVersion = "legacy" | "v2"

export function usePricingVersion(): PricingVersion | null | undefined {
  const { cacheScope, teamKey, ready } = useBillingContext()
  const { data, isError } = useQuery({
    queryKey: [
      "billing",
      "pricing-version",
      cacheScope,
      teamKey ?? "unresolved",
    ],
    queryFn: () =>
      apiClient<{ pricing_version?: string }>("/billing/plans/public", {
        cache: "no-store",
      }),
    enabled: ready,
    staleTime: 60_000,
  })
  if (!data) return isError ? null : undefined
  return data.pricing_version === "v2" ? "v2" : "legacy"
}
