"use client"

import { useQuery } from "@tanstack/react-query"

import { providerKeys } from "@/lib/api/query-keys"
import { listProviders } from "@/lib/api/secrets"

/**
 * Backend-of-record provider catalog. Long stale time — the list changes
 * rarely (when the platform adds a new provider shortcut).
 */
export function useProviders() {
  return useQuery({
    queryKey: providerKeys.all,
    queryFn: listProviders,
    staleTime: 30 * 60 * 1000, // 30 min
  })
}
