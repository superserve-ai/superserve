"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"

import { isLegacyTransition } from "@/lib/api/billing-capabilities"
import type { SignupPlanContext } from "@/lib/api/signup-plan"
import { getLegacyPlanEntryAction } from "@/lib/billing/plan-offers-actions"

import { useBillingCapabilities } from "./use-billing-capabilities"
import { useBillingContext } from "./use-billing-context"

export function useLegacyPlanTransition(enabled: boolean): boolean {
  const capabilities = useBillingCapabilities()
  const { cacheScope, teamKey, ready } = useBillingContext()
  const signup = useQueryClient().getQueryData<SignupPlanContext>([
    "signup-plan",
    teamKey,
  ])
  const fastPath =
    isLegacyTransition(capabilities.data) || signup?.legacyPlanEntry === true
  const query = useQuery({
    queryKey: ["legacy-plan-entry", cacheScope, teamKey],
    queryFn: async () => {
      const legacyPlanEntry = await getLegacyPlanEntryAction(teamKey!)
      if (legacyPlanEntry === null)
        throw new Error("Unable to check the plan migration")
      return legacyPlanEntry
    },
    enabled: enabled && ready && teamKey !== null && !fastPath,
    staleTime: (query) =>
      query.state.data === true ? Number.POSITIVE_INFINITY : 5 * 60_000,
    retry: false,
  })
  return fastPath || query.data === true
}
