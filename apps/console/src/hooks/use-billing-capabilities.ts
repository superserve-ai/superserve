"use client"

import { useQuery } from "@tanstack/react-query"

import { getBillingCapabilities } from "@/lib/api/billing-capabilities"
import { billingKeys } from "@/lib/api/query-keys"

import { useBillingContext } from "./use-billing-context"
import { useUser } from "./use-user"

export function useBillingCapabilities() {
  const { cacheScope, teamKey, ready } = useBillingContext()
  const actor = useUser().user?.id
  const query = useQuery({
    queryKey: billingKeys.capabilities({
      cacheScope,
      teamKey: teamKey ?? "unresolved",
      actor: actor ?? "unresolved",
    }),
    queryFn: () => getBillingCapabilities(teamKey!),
    enabled: ready && !!actor && teamKey !== null,
    retry: false,
    staleTime: 0,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  })
  // A failed refresh cannot retain permission from an earlier admission epoch.
  return {
    ...query,
    data: ready && !!actor && !query.isError ? query.data : undefined,
  }
}
