"use client"

import { usePostHog } from "posthog-js/react"
import { useEffect } from "react"

import { useBillingBlockActions } from "@/hooks/use-billing-block"
import { useBillingSummary } from "@/hooks/use-billing-summary"
import {
  BILLING_BLOCK_ACTION_LABEL,
  BILLING_BLOCK_FALLBACK_PATH,
  billingBlockFromCode,
  billingStillBlocked,
} from "@/lib/billing/billing-block"
import { BILLING_BLOCK_EVENTS } from "@/lib/posthog/events"

/**
 * The "Add card / choose plan" link beside a billing pause in the activity
 * log. Shown only while the team is still blocked, so an old pause does not
 * ask a paying team to pay again. Set `trackShown` on one link per view, so
 * the shown event counts views, not rows.
 */
export function BillingActivityAction({
  trackShown = false,
}: {
  trackShown?: boolean
}) {
  const posthog = usePostHog()
  const { trackShown: captureShown } = useBillingBlockActions()
  const summary = useBillingSummary().data
  const blocked = billingStillBlocked(summary)
  const block = billingBlockFromCode(
    summary?.trial_block ?? "billing_ineligible",
  )
  const { code, reason } = block

  useEffect(() => {
    if (trackShown && blocked) captureShown({ code, reason }, "activity")
  }, [trackShown, blocked, code, reason, captureShown])

  if (!blocked) return null
  return (
    <a
      href={BILLING_BLOCK_FALLBACK_PATH}
      onClick={(event) => {
        event.stopPropagation()
        posthog?.capture(BILLING_BLOCK_EVENTS.ACTION_CLICKED, {
          reason,
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
