"use client"

import { useQueryScope } from "@/components/query-provider"
import { TrialBillingBanner } from "@/components/trial-billing-banner"
import { useBillingCapabilities } from "@/hooks/use-billing-capabilities"
import { useBillingReturnNotice } from "@/hooks/use-billing-return-notice"
import { useBillingSummary } from "@/hooks/use-billing-summary"
import { usePrepaidBalance, useTeamPlan } from "@/hooks/use-billing-v2"
import type { TeamPlan } from "@/lib/api/billing-v2"

import { PlanAwareBanner } from "./plan-aware-banner"

function PricingV2Banner({ plan }: { plan: TeamPlan }) {
  const scope = useQueryScope()
  const capabilities = useBillingCapabilities()
  const summaryQuery = useBillingSummary()
  const summary = summaryQuery.isError ? undefined : summaryQuery.data
  const prepaid = usePrepaidBalance(plan.kind === "prepaid").data
  if (!summary?.permissions?.can_view) return null
  return (
    <PlanAwareBanner
      plan={plan}
      prepaid={prepaid ?? null}
      canManage={scope === "self" && summary.permissions.can_manage}
      canUpgrade={
        capabilities.data?.fresh_entry.pro === true ||
        capabilities.data?.fresh_entry.starter === true
      }
      canBuyCredit={capabilities.data?.fresh_entry.starter === true}
      canConfigureRecharge={
        capabilities.data?.fresh_entry.auto_recharge === true
      }
    />
  )
}

export function PlanBanner() {
  useBillingReturnNotice()
  const plan = useTeamPlan(true).data
  if (plan === undefined) return null
  if (!plan || plan.kind === "legacy_payg") return <TrialBillingBanner />
  return <PricingV2Banner plan={plan} />
}
