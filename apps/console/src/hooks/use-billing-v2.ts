"use client"

import { type Query, useQuery } from "@tanstack/react-query"
import { useCallback } from "react"
import type { z } from "zod"

import { getBillingPricing } from "@/lib/api/billing"
import {
  BILLING_V2_PATHS,
  freeAllowanceSchema,
  prepaidBalanceSchema,
  teamEntrySchema,
  teamPlanSchema,
} from "@/lib/api/billing-v2"
import { apiClient } from "@/lib/api/client"
import { billingKeys } from "@/lib/api/query-keys"

import { useBillingContext } from "./use-billing-context"

// Caches the response as read, so readers of the same resource share one
// request and each parses the part it needs.
function useBillingV2Resource<T>(
  resource: keyof typeof BILLING_V2_PATHS,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  enabled: boolean,
  refetchInterval: number | ((query: Query) => number) = 60_000,
) {
  const { cacheScope, teamKey, ready } = useBillingContext()
  const select = useCallback((raw: unknown) => schema.parse(raw), [schema])
  const query = useQuery({
    queryKey: billingKeys.v2(resource, { cacheScope, teamKey: teamKey ?? "" }),
    queryFn: () =>
      apiClient<unknown>(BILLING_V2_PATHS[resource], { cache: "no-store" }),
    select,
    enabled: enabled && ready && teamKey !== null,
    staleTime: 30_000,
    refetchInterval,
  })
  return { ...query, data: query.isError ? undefined : query.data }
}

export function useTeamPlan(enabled: boolean) {
  return useBillingV2Resource("plan", teamPlanSchema, enabled)
}

export function useTeamEntry(enabled: boolean) {
  return useBillingV2Resource("plan", teamEntrySchema, enabled)
}

export function useFreeAllowance(enabled: boolean) {
  return useBillingV2Resource("free-allowance", freeAllowanceSchema, enabled)
}

// An unobserved balance shows "Updating…" but is usually observed within
// seconds, so re-read it quickly for a minute from when it became unobserved;
// a failing read falls back to the minute cycle.
const unobservedSince = new WeakMap<Query, number>()

export function prepaidRefetchInterval(query: Query) {
  const { data, status, dataUpdatedAt } = query.state
  if (
    (data as { balance_observed?: unknown } | undefined)?.balance_observed !==
    false
  ) {
    unobservedSince.delete(query)
    return 60_000
  }
  const since = unobservedSince.get(query) ?? dataUpdatedAt
  unobservedSince.set(query, since)
  return status !== "error" && dataUpdatedAt - since < 60_000 ? 3_000 : 60_000
}

export function usePrepaidBalance(enabled: boolean) {
  return useBillingV2Resource(
    "prepaid",
    prepaidBalanceSchema,
    enabled,
    prepaidRefetchInterval,
  )
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
