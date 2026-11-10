"use client"

import { CreditCardIcon } from "@phosphor-icons/react"
import { useEffect } from "react"

import { EmptyState } from "@/components/empty-state"
import { useBillingBlockActions } from "@/hooks/use-billing-block"
import {
  BILLING_BLOCK_ACTION_LABEL,
  type BillingBlock,
  type BillingBlockSurface,
} from "@/lib/billing/billing-block"

/** A full-page billing block with its "Add card / choose plan" button. */
export function BillingBlockState({
  block,
  surface,
}: {
  block: BillingBlock
  surface: BillingBlockSurface
}) {
  const { trackShown, openAction } = useBillingBlockActions()
  const { code, reason } = block

  // Once per block shown, not on every render.
  useEffect(() => {
    trackShown({ code, reason }, surface)
  }, [code, reason, surface, trackShown])

  return (
    <EmptyState
      icon={CreditCardIcon}
      title={block.title}
      description={block.description}
      actionLabel={BILLING_BLOCK_ACTION_LABEL}
      onAction={() => openAction(block, surface)}
    />
  )
}
