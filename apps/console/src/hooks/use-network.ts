"use client"

import { useQuery } from "@tanstack/react-query"

import { networkKeys } from "@/lib/api/query-keys"
import { getSandboxNetwork } from "@/lib/api/secrets"

export const NETWORK_PAGE_SIZE = 50

/** The most recent per-sandbox network events. The dashboard shows a recent
 *  window; the full log is available via the API. */
export function useSandboxNetwork(sandboxId: string | undefined) {
  return useQuery({
    queryKey: networkKeys.sandbox(sandboxId),
    queryFn: () => getSandboxNetwork(sandboxId!, { limit: NETWORK_PAGE_SIZE }),
    enabled: Boolean(sandboxId),
  })
}
