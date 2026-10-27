"use client"

import { Button } from "@superserve/ui"

import type { PendingStarterCheckout } from "@/lib/api/starter-checkout-recovery"
import { formatUsdCents } from "@/lib/billing/plans"

export function PendingStarterPayment({
  purchase,
  busy,
  canManage,
  error,
  onResume,
  onCancel,
  onCheckPayment,
  choosingPro = true,
}: {
  purchase: PendingStarterCheckout
  busy: boolean
  canManage: boolean
  error: string | null
  onResume: () => void
  onCheckPayment: () => void
  onCancel: () => void
  choosingPro?: boolean
}) {
  return (
    <div className="space-y-3 p-6">
      <h2 className="text-lg font-medium">
        Finish or cancel your credit purchase
      </h2>
      <p className="text-sm">
        You have an unfinished Starter credit purchase. Resume it, or cancel the
        unpaid checkout{" "}
        {choosingPro
          ? "before choosing Pro"
          : "before starting another payment"}
        . If payment was completed, we’ll confirm the original purchase first.
      </p>
      <div className="flex flex-col items-start gap-3">
        <Button disabled={busy || !canManage} onClick={onResume}>
          Resume your {formatUsdCents(purchase.amount_cents)} credit purchase
        </Button>
        <Button
          variant="outline"
          disabled={busy || !canManage}
          onClick={onCancel}
        >
          {choosingPro
            ? "Cancel this purchase and choose Pro"
            : "Cancel this unpaid purchase"}
        </Button>
        <Button disabled={busy || !canManage} onClick={onCheckPayment}>
          Check purchase status
        </Button>
      </div>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
