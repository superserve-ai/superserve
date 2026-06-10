"use client"

import { useInfiniteQuery } from "@tanstack/react-query"

import { networkKeys } from "@/lib/api/query-keys"
import { getSandboxNetwork } from "@/lib/api/secrets"

const PAGE_SIZE = 50

/** The unified per-sandbox network log, paginated by the `ts` cursor. */
export function useSandboxNetwork(sandboxId: string | undefined) {
  return useInfiniteQuery({
    queryKey: networkKeys.sandbox(sandboxId),
    queryFn: ({ pageParam }) =>
      getSandboxNetwork(sandboxId!, { before: pageParam, limit: PAGE_SIZE }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.length === PAGE_SIZE
        ? lastPage[lastPage.length - 1].ts
        : undefined,
    enabled: Boolean(sandboxId),
  })
}
