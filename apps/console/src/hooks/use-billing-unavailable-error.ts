"use client"

import { useEffect, useState } from "react"

import { isBillingUsageUnavailable } from "./billing-query-retry"

// Another observer of the shared query may refresh it in the background.
// Keep the unavailable presentation until that request succeeds, scoped to
// the current view. This retains no successful usage or account authority.
export function useBillingUnavailableError(
  query: { error: Error | null; isPending: boolean },
  identity: string,
): Error | null {
  const [last, setLast] = useState<{ identity: string; error: Error } | null>(
    null,
  )
  useEffect(() => {
    if (query.error && isBillingUsageUnavailable(query.error))
      setLast({ identity, error: query.error })
    else if (!query.isPending) setLast(null)
  }, [query.error, query.isPending, identity])
  return (
    query.error ??
    (query.isPending && last?.identity === identity ? last.error : null)
  )
}
