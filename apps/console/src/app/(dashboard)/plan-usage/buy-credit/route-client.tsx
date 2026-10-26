"use client"

import { Spinner } from "@superserve/ui"

import {
  usePrepaidCredit,
  useRetainedPrepaidOperations,
} from "@/hooks/use-prepaid-credit"
import { usePricingVersion } from "@/hooks/use-pricing-version"

import { PlanUsagePageClient } from "../page-client"
import { BuyCreditPageClient } from "./page-client"

export function BuyCreditRoute() {
  const version = usePricingVersion()
  const existing = usePrepaidCredit(version !== undefined && version !== "v2")
  const retained = useRetainedPrepaidOperations(existing.data?.purchases)
  if (version === "v2") return <BuyCreditPageClient />
  if (
    retained.length > 0 ||
    (existing.data?.balance_cents ?? 0) !== 0 ||
    existing.data?.auto_recharge.enabled ||
    existing.data?.purchases.length
  )
    return <BuyCreditPageClient allowEntry={false} />
  if (version === undefined || existing.isLoading) return <Spinner />
  if (version === null)
    return (
      <p role="alert" className="p-4 text-sm text-destructive">
        Pricing is unavailable. Please reload to try again.
      </p>
    )
  if (existing.error)
    return (
      <p role="alert" className="p-4 text-sm text-destructive">
        Credit settings are unavailable. Please reload to try again.
      </p>
    )
  return <PlanUsagePageClient />
}
