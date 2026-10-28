"use client"

import { useQueryScope } from "@/components/query-provider"
import { TrialBillingBanner } from "@/components/trial-billing-banner"
import { useBillingCapabilities } from "@/hooks/use-billing-capabilities"
import { useBillingReturnNotice } from "@/hooks/use-billing-return-notice"
import { useBillingSummary } from "@/hooks/use-billing-summary"
import { usePrepaidBalance, useTeamPlan } from "@/hooks/use-billing-v2"
import { canStartAnyPlan, canStartPlan } from "@/lib/api/billing-capabilities"
import type { BillingCapabilities } from "@/lib/api/billing-capabilities"
import {
  fundedByCredit,
  type TeamPlan,
  upgradePath,
} from "@/lib/api/billing-v2"

import { PlanAwareBanner, type UpgradeChoice } from "./plan-aware-banner"

// The monthly plans this team can buy from the upgrade page right now, by
// the same per-plan check the upgrade page makes.
function upgradeChoices(
  capabilities: BillingCapabilities | undefined,
): UpgradeChoice[] {
  return (capabilities?.catalog?.cards ?? []).flatMap((card) => {
    const href = card.kind === "subscription" ? upgradePath(card.family) : null
    return href &&
      card.monthly?.available &&
      canStartPlan(capabilities, {
        key: card.monthly.offer_key,
        kind: card.kind,
      })
      ? [{ name: card.name, href }]
      : []
  })
}

function PricingV2Banner({ plan }: { plan: TeamPlan }) {
  const scope = useQueryScope()
  const capabilities = useBillingCapabilities().data
  const offers = capabilities?.offers
  const summaryQuery = useBillingSummary()
  const summary = summaryQuery.isError ? undefined : summaryQuery.data
  const prepaid = usePrepaidBalance(fundedByCredit(plan, offers)).data
  if (!summary?.permissions?.can_view) return null
  return (
    <PlanAwareBanner
      plan={plan}
      offers={offers}
      upgradeChoices={upgradeChoices(capabilities)}
      fundingState={summary.trial?.state}
      prepaid={prepaid ?? null}
      canManage={scope === "self" && summary.permissions.can_manage}
      canUpgrade={canStartAnyPlan(capabilities)}
      canBuyCredit={canStartPlan(capabilities, plan)}
      canConfigureRecharge={capabilities?.fresh_entry.auto_recharge === true}
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
