"use client"

import { CurrentPlan } from "@/components/current-plan"
import {
  useFreeAllowance,
  usePrepaidBalance,
  useTeamPlan,
} from "@/hooks/use-billing-v2"
import { usePricingVersion } from "@/hooks/use-pricing-version"
import type { BillingSummaryResponse } from "@/lib/api/billing"

import { PlanOverview } from "./plan-overview"

function toCents(usd: number | null | undefined): number | null {
  return typeof usd === "number" && Number.isFinite(usd)
    ? Math.round(usd * 100)
    : null
}

function PricingV2Overview({ summary }: { summary: BillingSummaryResponse }) {
  const planQuery = useTeamPlan(true)
  const plan = planQuery.data
  const allowance = useFreeAllowance(plan?.kind === "free").data
  const prepaid = usePrepaidBalance(plan?.kind === "prepaid").data
  if (!plan) {
    return planQuery.isError ? <CurrentPlan summary={summary} /> : null
  }
  if (plan.kind === "legacy_payg") return <CurrentPlan summary={summary} />
  return (
    <PlanOverview
      plan={plan}
      allowance={allowance ?? null}
      prepaid={prepaid ?? null}
      usageCents={toCents(summary.current_charges_usd)}
      canManage={summary.permissions?.can_manage ?? false}
    />
  )
}

export function PlanOverviewSection({
  summary,
}: {
  summary: BillingSummaryResponse
}) {
  return usePricingVersion() === "v2" ? (
    <PricingV2Overview summary={summary} />
  ) : (
    <CurrentPlan summary={summary} />
  )
}
