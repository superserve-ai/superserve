"use client"

import { useQuery } from "@tanstack/react-query"
import type { z } from "zod"

import { getBillingPricing } from "@/lib/api/billing"
import {
  BILLING_V2_PATHS,
  freeAllowanceSchema,
  prepaidBalanceSchema,
  proCheckoutPlanSchema,
  teamPlanSchema,
} from "@/lib/api/billing-v2"
import { apiClient } from "@/lib/api/client"
import { billingKeys } from "@/lib/api/query-keys"

import { useBillingContext } from "./use-billing-context"

function useBillingV2Resource<T>(
  resource: keyof typeof BILLING_V2_PATHS,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  enabled: boolean,
  variant?: "pro-checkout",
) {
  const { cacheScope, teamKey, ready } = useBillingContext()
  const query = useQuery({
    queryKey: [
      ...billingKeys.v2(resource, { cacheScope, teamKey: teamKey ?? "" }),
      ...(variant ? [variant] : []),
    ],
    queryFn: async () =>
      schema.parse(
        await apiClient<unknown>(BILLING_V2_PATHS[resource], {
          cache: "no-store",
        }),
      ),
    enabled: enabled && ready && teamKey !== null,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
  return { ...query, data: query.isError ? undefined : query.data }
}

export function useProCheckoutTerms(enabled: boolean) {
  return useBillingV2Resource(
    "plan",
    proCheckoutPlanSchema,
    enabled,
    "pro-checkout",
  )
}

export function useTeamPlan(enabled: boolean) {
  return useBillingV2Resource("plan", teamPlanSchema, enabled)
}

export function useFreeAllowance(enabled: boolean) {
  return useBillingV2Resource("free-allowance", freeAllowanceSchema, enabled)
}

export function usePrepaidBalance(enabled: boolean) {
  return useBillingV2Resource("prepaid", prepaidBalanceSchema, enabled)
}

export function useAllowancePricing(enabled: boolean) {
  const { cacheScope, teamKey, ready } = useBillingContext()
  const query = useQuery({
    queryKey: billingKeys.settings({
      cacheScope,
      teamKey: teamKey ?? "unresolved",
    }),
    queryFn: getBillingPricing,
    enabled: enabled && ready && teamKey !== null,
    staleTime: 30_000,
  })
  return { ...query, data: query.isError ? undefined : query.data }
}
