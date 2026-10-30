"use client"

import { Button, Spinner } from "@superserve/ui"

export const SETTLE_POLL_MS = 1500
export const SETTLE_TIMEOUT_MS = 120_000

export function PaymentProcessing({
  waiting,
  canRetry = true,
  onRetry,
}: {
  waiting: boolean
  canRetry?: boolean
  onRetry: () => void
}) {
  if (waiting)
    return (
      <div className="flex items-center gap-3">
        <Spinner size="sm" />
        <output className="text-sm">Processing payment…</output>
      </div>
    )
  return (
    <div className="space-y-3">
      <output className="block text-sm">
        Your payment is still being confirmed. This can take a few more minutes,
        and your plan starts as soon as it’s confirmed.
      </output>
      <Button size="sm" disabled={!canRetry} onClick={onRetry}>
        Try again
      </Button>
    </div>
  )
}
