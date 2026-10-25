"use client"

import { useQueryScope } from "@/components/query-provider"
import { TrialBillingBanner } from "@/components/trial-billing-banner"
import { useBillingReturnNotice } from "@/hooks/use-billing-return-notice"
import { useBillingSummary } from "@/hooks/use-billing-summary"
import { usePrepaidBalance, useTeamPlan } from "@/hooks/use-billing-v2"
import { usePricingVersion } from "@/hooks/use-pricing-version"
import type { TeamPlan } from "@/lib/api/billing-v2"

import { PlanAwareBanner } from "./plan-aware-banner"

function PricingV2Banner({ plan }: { plan: TeamPlan }) {
  const scope = useQueryScope()
  useBillingReturnNotice()
  const summaryQuery = useBillingSummary()
  const summary = summaryQuery.isError ? undefined : summaryQuery.data
  const prepaid = usePrepaidBalance(plan.kind === "prepaid").data
  if (!summary?.permissions?.can_view) return null
  return (
    <PlanAwareBanner
      plan={plan}
      prepaid={prepaid ?? null}
      canManage={scope === "self" && summary.permissions.can_manage}
    />
  )
}

export function PlanBanner() {
  const version = usePricingVersion()
  const plan = useTeamPlan(version === "v2").data
  if (version !== "v2" || !plan || plan.kind === "legacy_payg")
    return <TrialBillingBanner />
  return <PricingV2Banner plan={plan} />
}
