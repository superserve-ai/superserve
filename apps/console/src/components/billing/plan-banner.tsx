"use client"

import { TrialBillingBanner } from "@/components/trial-billing-banner"
import { useBillingReturnNotice } from "@/hooks/use-billing-return-notice"
import { useBillingSummary } from "@/hooks/use-billing-summary"
import { usePrepaidBalance, useTeamPlan } from "@/hooks/use-billing-v2"
import { usePricingVersion } from "@/hooks/use-pricing-version"

import { PlanAwareBanner } from "./plan-aware-banner"

function PricingV2Banner() {
  useBillingReturnNotice()
  const summary = useBillingSummary().data
  const plan = useTeamPlan(true).data
  const prepaid = usePrepaidBalance(plan?.kind === "prepaid").data
  if (!summary?.permissions?.can_view || !plan) return null
  return (
    <PlanAwareBanner
      plan={plan}
      prepaid={prepaid ?? null}
      canManage={summary.permissions.can_manage}
    />
  )
}

export function PlanBanner() {
  const version = usePricingVersion()
  const plan = useTeamPlan(version === "v2").data
  if (version !== "v2" || plan?.kind === "legacy_payg")
    return <TrialBillingBanner />
  return <PricingV2Banner />
}
