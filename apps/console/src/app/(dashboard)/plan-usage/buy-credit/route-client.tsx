"use client"

import { Spinner } from "@superserve/ui"
import { useSearchParams } from "next/navigation"

import {
  usePrepaidCredit,
  useRetainedPrepaidOperations,
} from "@/hooks/use-prepaid-credit"
import { usePricingVersion } from "@/hooks/use-pricing-version"

import { PlanUsagePageClient } from "../page-client"
import { BuyCreditPageClient } from "./page-client"

export function BuyCreditRoute() {
  const params = useSearchParams()
  const returning =
    params.has("purchase") ||
    params.has("team") ||
    params.has("purchase_id") ||
    params.has("billing_flow")
  const version = usePricingVersion()
  const existing = usePrepaidCredit(
    !returning && version !== undefined && version !== "v2",
  )
  const retained = useRetainedPrepaidOperations(existing.data?.purchases)
  if (returning) return <BuyCreditPageClient allowEntry={version === "v2"} />
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
