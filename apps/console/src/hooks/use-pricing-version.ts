"use client"

import { catalogPlansOf } from "@/lib/api/billing-v2"
import type { PricingVersion } from "@/lib/billing/plans"

import { useBillingCapabilities } from "./use-billing-capabilities"

export function usePricingVersion(): PricingVersion | null | undefined {
  const query = useBillingCapabilities()
  if (query.isError) return null
  return query.data?.pricing_version
}

export function usePricingVersionState(): PricingVersion | "unknown" {
  return usePricingVersion() ?? "unknown"
}

export function useCatalogPlans() {
  const query = useBillingCapabilities()
  return {
    ...query,
    data: query.data ? catalogPlansOf(query.data.catalog) : undefined,
  }
}
