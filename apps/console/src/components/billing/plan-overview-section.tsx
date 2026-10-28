"use client"

import { CurrentPlan } from "@/components/current-plan"
import { useQueryScope } from "@/components/query-provider"
import { useBillingCapabilities } from "@/hooks/use-billing-capabilities"
import {
  useFreeAllowance,
  useAllowancePricing,
  usePrepaidBalance,
  useTeamPlan,
} from "@/hooks/use-billing-v2"
import type { BillingSummaryResponse } from "@/lib/api/billing"
import { canStartAnyPlan, canStartPlan } from "@/lib/api/billing-capabilities"
import { fundedByCredit, planTopoff, type TeamPlan } from "@/lib/api/billing-v2"
import { type BillingOffer, findOffer } from "@/lib/billing/plans"

import { AutoTopoffSettings } from "./auto-topoff-card"
import { type CancelChannel, PlanDetails, PlanOverview } from "./plan-overview"

function toCents(usd: number | null | undefined): number | null {
  return typeof usd === "number" && Number.isFinite(usd)
    ? Math.round(usd * 100)
    : null
}

// Developer is supported by email and Pro by priority Slack or email; a plan
// the catalog doesn't name follows its funding.
function cancelChannel(
  plan: TeamPlan,
  funded: boolean,
  offers: readonly BillingOffer[] | undefined,
): CancelChannel {
  const family = findOffer(offers, plan.key)?.family
  if (family === "developer") return "email"
  if (family === "pro") return "priority"
  return funded ? "email" : "priority"
}

const SETTLING_MS = 10 * 60_000

function recentlyEffective(effectiveFrom: string): boolean {
  const since = Date.now() - Date.parse(effectiveFrom)
  return Number.isFinite(since) && since >= 0 && since < SETTLING_MS
}

export function PlanOverviewSection({
  summary,
  details = false,
}: {
  summary: BillingSummaryResponse
  details?: boolean
}) {
  const scope = useQueryScope()
  const capabilities = useBillingCapabilities()
  const planQuery = useTeamPlan(true)
  const plan = planQuery.data
  const allowance = useFreeAllowance(!details && plan?.kind === "free").data
  const pricing = useAllowancePricing(!details && plan?.kind === "free").data
  const funded =
    !!plan &&
    plan.kind === "subscription" &&
    fundedByCredit(plan, capabilities.data?.offers)
  const prepaid = usePrepaidBalance(
    !details && (plan?.kind === "prepaid" || funded),
  ).data
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
  // The summary's contract and the plan assignment briefly disagree while a
  // purchase or renewal settles; wait only while that is plausibly the case,
  // so a lasting difference never leaves the plan loading.
  if (
    plan.kind === "subscription" &&
    summary.plan &&
    (summary.plan.key !== plan.key || summary.plan.status === "pending") &&
    (summary.plan.status === "pending" ||
      recentlyEffective(plan.effective_from))
  )
    return <p className="text-sm text-muted">Loading your plan…</p>
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
  const canManage =
    scope === "self" && (summary.permissions?.can_manage ?? false)
  if (details)
    return (
      <>
        <PlanDetails
          plan={{
            ...plan,
            fee_cents:
              commercial?.billing_interval_months === 1
                ? toCents(commercial.price_usd)
                : null,
          }}
          canManage={canManage}
          cancelChannel={cancelChannel(plan, funded, capabilities.data?.offers)}
        />
        {funded ? (
          <AutoTopoffSettings
            topoff={planTopoff(plan, capabilities.data?.offers)}
            canManage={canManage}
          />
        ) : null}
      </>
    )
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
      allowance={allowance ?? null}
      prepaid={prepaid ?? null}
      usageCents={matchingPeriod ? toCents(summary.current_charges_usd) : null}
      funded={funded}
      canManage={canManage}
      canPurchase={
        plan.kind === "free"
          ? canStartAnyPlan(capabilities.data)
          : canStartPlan(capabilities.data, plan)
      }
    />
  )
}
