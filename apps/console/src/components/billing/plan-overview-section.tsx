"use client"

import { CurrentPlan } from "@/components/current-plan"
import {
  useFreeAllowance,
  usePrepaidBalance,
  useTeamPlan,
} from "@/hooks/use-billing-v2"
import type { BillingSummaryResponse } from "@/lib/api/billing"

import { PlanOverview } from "./plan-overview"

function toCents(usd: number | null | undefined): number | null {
  return typeof usd === "number" && Number.isFinite(usd)
    ? Math.round(usd * 100)
    : null
}

export function PlanOverviewSection({
  summary,
}: {
  summary: BillingSummaryResponse
}) {
  const plan = useTeamPlan(true).data
  const allowance = useFreeAllowance(plan?.kind === "free").data
  const prepaid = usePrepaidBalance(plan?.kind === "prepaid").data
  if (!plan || plan.kind === "legacy_payg")
    return <CurrentPlan summary={summary} />
  const commercial = summary.plan?.key === plan.key ? summary.plan : null
  const matchingPeriod =
    Date.parse(plan.period_start ?? "") ===
      Date.parse(summary.billing_period?.start ?? "") &&
    Date.parse(plan.period_end ?? "") ===
      Date.parse(summary.billing_period?.end ?? "")
  const included = commercial?.included_usage
  const matchingIncluded =
    included &&
    matchingPeriod &&
    Date.parse(included.period_start) === Date.parse(plan.period_start ?? "") &&
    Date.parse(included.period_end) === Date.parse(plan.period_end ?? "")
      ? included
      : null
  const includedCents =
    matchingIncluded?.status === "issued"
      ? toCents(matchingIncluded.amount_usd)
      : null
  return (
    <PlanOverview
      plan={{
        ...plan,
        fee_cents:
          commercial?.billing_interval_months === 1
            ? toCents(commercial.price_usd)
            : null,
        included_cents: includedCents,
      }}
      includedUsageStatus={matchingIncluded?.status}
      allowance={allowance ?? null}
      prepaid={prepaid ?? null}
      usageCents={matchingPeriod ? toCents(summary.current_charges_usd) : null}
      canManage={summary.permissions?.can_manage ?? false}
    />
  )
}
