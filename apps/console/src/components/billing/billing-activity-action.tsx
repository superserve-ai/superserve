"use client"

import { usePostHog } from "posthog-js/react"

import { useBillingSummary } from "@/hooks/use-billing-summary"
import type { BillingSummaryResponse } from "@/lib/api/billing"
import {
  BILLING_BLOCK_ACTION_LABEL,
  BILLING_BLOCK_FALLBACK_PATH,
  billingBlockReason,
} from "@/lib/billing/billing-block"
import { BILLING_BLOCK_EVENTS } from "@/lib/posthog/events"

const BLOCKED_PLAN_STATES = new Set([
  "trial_ended",
  "payment_failed",
  "plan_required",
])

// The team still cannot run sandboxes for a billing reason.
export function billingStillBlocked(
  summary: BillingSummaryResponse | undefined,
): boolean {
  if (!summary) return false
  return (
    !!summary.trial_block || BLOCKED_PLAN_STATES.has(summary.plan?.status ?? "")
  )
}

/**
 * The "Add card / choose plan" link beside a billing pause in the activity
 * log. Shown only while the team is still blocked, so an old pause does not
 * ask a paying team to pay again.
 */
export function BillingActivityAction() {
  const posthog = usePostHog()
  const summary = useBillingSummary().data
  if (!summary || !billingStillBlocked(summary)) return null
  const code = summary.trial_block ?? "billing_ineligible"
  return (
    <a
      href={BILLING_BLOCK_FALLBACK_PATH}
      onClick={(event) => {
        event.stopPropagation()
        posthog?.capture(BILLING_BLOCK_EVENTS.ACTION_CLICKED, {
          reason: billingBlockReason(code),
          code,
          surface: "activity",
        })
      }}
      className="text-xs whitespace-nowrap text-primary underline-offset-4 hover:underline"
    >
      {BILLING_BLOCK_ACTION_LABEL}
    </a>
  )
}
