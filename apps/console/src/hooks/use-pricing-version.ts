"use client"

import { type CatalogPlan, catalogPlansOf } from "@/lib/api/billing-v2"
import {
  type PricingVersion,
  pricingVersionOf,
} from "@/lib/api/pricing-version"

import { usePublicBillingPlans } from "./use-public-billing-plans"

export function usePricingVersionState(): PricingVersion | "unknown" {
  const query = usePublicBillingPlans()
  if (query.isError) return "legacy"
  return query.data === undefined ? "unknown" : pricingVersionOf(query.data)
}

export function usePricingVersion(): PricingVersion | null | undefined {
  const query = usePublicBillingPlans()
  if (query.isError) return null
  return query.data === undefined ? undefined : pricingVersionOf(query.data)
}

export function useCatalogPlans() {
  return usePublicBillingPlans<CatalogPlan[]>(undefined, true, catalogPlansOf)
}
