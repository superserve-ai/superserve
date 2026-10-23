"use server"

import type {
  PlanChangeActionResult,
  PlanChangePreviewResult,
} from "@/app/(dashboard)/admin/billing/teams/[team_id]/actions"

const terms = {
  pro_monthly: [120000, 1, 100000],
  pro_annual: [1200000, 12, 100000],
  starter_monthly: [10000, 1, 10000],
  starter_annual: [100000, 12, 10000],
} as const

export async function previewPlanChangeAction(input: {
  targetOffer: string
}): Promise<PlanChangePreviewResult> {
  const known = terms[input.targetOffer as keyof typeof terms]
  const [fee_cents, interval_months, monthly_credit_cents] = known ?? [0, 0, 0]
  const preview = {
    target_offer: input.targetOffer,
    terms: {
      offer_key: input.targetOffer,
      fee_cents,
      interval_months,
      monthly_credit_cents,
    },
  }
  if (input.targetOffer === "starter_monthly")
    return {
      kind: "preview",
      preview: {
        ...preview,
        blocked: "team's invoices are not yet held for reconciliation",
      },
    }
  const annual = interval_months === 12
  return {
    kind: "preview",
    preview: {
      ...preview,
      effective_at: annual ? "2027-03-14T09:00:00Z" : "2026-11-14T09:00:00Z",
      timing: annual
        ? "annual_fee_starts_on_yearly_anniversary"
        : "next_anniversary",
    },
  }
}

export async function schedulePlanChangeAction(): Promise<PlanChangeActionResult> {
  return { kind: "unavailable" }
}

export async function cancelPlanChangeAction(): Promise<PlanChangeActionResult> {
  return { kind: "unavailable" }
}

export async function grantStaffCreditAction(): Promise<PlanChangeActionResult> {
  return { kind: "unavailable" }
}
