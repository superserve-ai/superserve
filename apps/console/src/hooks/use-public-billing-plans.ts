"use client"

import { type UseQueryResult, useQuery } from "@tanstack/react-query"

import { billingKeys } from "@/lib/api/query-keys"
import type { PublicBillingPlans } from "@/lib/billing/plans"
import { getPublicBillingPlansAction } from "@/lib/billing/plans-actions"

export function usePublicBillingPlans(
  region?: string,
  enabled = true,
): UseQueryResult<PublicBillingPlans, Error> {
  return useQuery<PublicBillingPlans, Error>({
    queryKey: billingKeys.publicPlans(region ?? "default"),
    queryFn: () => getPublicBillingPlansAction(region),
    staleTime: 300_000,
    enabled,
  })
}
