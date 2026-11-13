"use client"

import { useToast } from "@superserve/ui"
import { usePostHog } from "posthog-js/react"
import { useCallback } from "react"

import {
  BILLING_BLOCK_ACTION_LABEL,
  type BillingBlock,
  billingBlockFromError,
  type BillingBlockSurface,
} from "@/lib/billing/billing-block"
import { BILLING_BLOCK_EVENTS } from "@/lib/posthog/events"

// Long enough to read the message and reach the button.
const BILLING_BLOCK_TOAST_MS = 12_000

type BlockKind = Pick<BillingBlock, "reason" | "code">

function blockProps(block: BlockKind, surface: BillingBlockSurface) {
  return { reason: block.reason, code: block.code, surface }
}

/** Tracking and navigation for a billing block's next step. */
export function useBillingBlockActions() {
  const posthog = usePostHog()

  const trackShown = useCallback(
    (block: BlockKind, surface: BillingBlockSurface) => {
      posthog?.capture(BILLING_BLOCK_EVENTS.SHOWN, blockProps(block, surface))
    },
    [posthog],
  )

  // A full page load, so the dashboard layout can forward a team that awaits
  // a plan to the plan picker with its checkout details.
  const openAction = useCallback(
    (block: BillingBlock, surface: BillingBlockSurface) => {
      posthog?.capture(
        BILLING_BLOCK_EVENTS.ACTION_CLICKED,
        blockProps(block, surface),
      )
      window.location.assign(block.href)
    },
    [posthog],
  )

  return { trackShown, openAction }
}

/**
 * Shows a 402 billing block as a toast with an "Add card / choose plan"
 * button. Returns false for any other error, so the caller keeps its own
 * message.
 */
export function useBillingBlockToast() {
  const { addToast } = useToast()
  const { trackShown, openAction } = useBillingBlockActions()

  return useCallback(
    (error: unknown, surface: BillingBlockSurface): boolean => {
      const block = billingBlockFromError(error)
      if (!block) return false
      trackShown(block, surface)
      addToast({
        title: block.title,
        description: block.description,
        variant: "error",
        duration: BILLING_BLOCK_TOAST_MS,
        actions: [
          {
            label: BILLING_BLOCK_ACTION_LABEL,
            onClick: () => openAction(block, surface),
          },
        ],
      })
      return true
    },
    [addToast, trackShown, openAction],
  )
}
