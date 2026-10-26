"use client"

import { CurrentPlan } from "@/components/current-plan"
import { useQueryScope } from "@/components/query-provider"
import {
  useFreeAllowance,
  useAllowancePricing,
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
  const scope = useQueryScope()
  const planQuery = useTeamPlan(true)
  const plan = planQuery.data
  const allowance = useFreeAllowance(plan?.kind === "free").data
  const pricing = useAllowancePricing(plan?.kind === "free").data
  const prepaid = usePrepaidBalance(plan?.kind === "prepaid").data
  if (plan === undefined)
    return (
      <p className="text-sm text-muted">
        {planQuery.isError
          ? "Your plan could not be loaded."
          : "Loading your plan…"}
      </p>
    )
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
  const bridgeMonthlyStartsAt =
    plan.kind === "subscription" &&
    commercial?.status === "pending" &&
    matchingPeriod &&
    !matchingIncluded &&
    commercial.starts_at &&
    Date.parse(commercial.starts_at) === Date.parse(plan.period_end ?? "")
      ? commercial.starts_at
      : undefined
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
      allowancePricing={pricing ?? null}
      includedUsageStatus={matchingIncluded?.status}
      bridgeMonthlyStartsAt={bridgeMonthlyStartsAt}
      allowance={allowance ?? null}
      prepaid={prepaid ?? null}
      usageCents={matchingPeriod ? toCents(summary.current_charges_usd) : null}
      canManage={scope === "self" && (summary.permissions?.can_manage ?? false)}
    />
  )
}
