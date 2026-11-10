"use client"

import { Spinner } from "@superserve/ui"
import { useSearchParams } from "next/navigation"

import { useBillingCapabilities } from "@/hooks/use-billing-capabilities"
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
    params.has("billing") ||
    params.has("purchase") ||
    params.has("team") ||
    params.has("purchase_id") ||
    params.has("billing_flow")
  const capabilities = useBillingCapabilities()
  const version = usePricingVersion()
  const entry = capabilities.data?.fresh_entry.starter === true
  const recovery =
    !capabilities.isPending &&
    capabilities.data?.actions?.recover_payment !== false
  const disableRecharge =
    !capabilities.isPending &&
    capabilities.data?.actions?.disable_auto_recharge !== false
  const recharge = capabilities.data?.fresh_entry.auto_recharge === true
  const existing = usePrepaidCredit(
    !returning && version !== undefined && version !== "v2",
  )
  const retained = useRetainedPrepaidOperations(existing.data?.purchases)
  if (returning)
    return (
      <BuyCreditPageClient
        allowEntry={entry}
        allowRecharge={recharge}
        allowDisableRecharge={disableRecharge}
        allowRecovery={recovery}
      />
    )
  if (version === "v2")
    return (
      <BuyCreditPageClient
        allowEntry={entry}
        allowRecharge={recharge}
        allowDisableRecharge={disableRecharge}
        allowRecovery={recovery}
      />
    )
  if (
    retained.length > 0 ||
    (existing.data?.balance_cents ?? 0) !== 0 ||
    existing.data?.auto_recharge.enabled ||
    existing.data?.purchases.length
  )
    return (
      <BuyCreditPageClient
        allowEntry={false}
        allowDisableRecharge={disableRecharge}
        allowRecovery={recovery}
      />
    )
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
