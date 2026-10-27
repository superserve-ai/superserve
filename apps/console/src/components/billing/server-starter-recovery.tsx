"use client"

import { Button } from "@superserve/ui"

import type { usePendingStarterCheckout } from "@/hooks/use-pending-starter-checkout"

import { PendingStarterPayment } from "./pending-starter-payment"

export function ServerStarterRecovery({
  recovery,
  canManage,
  choosingPro = false,
  onCheckProStatus,
}: {
  recovery: ReturnType<typeof usePendingStarterCheckout>
  canManage: boolean
  choosingPro?: boolean
  onCheckProStatus?: () => void
}) {
  if (!recovery.visible) return null
  if (recovery.purchase)
    return (
      <PendingStarterPayment
        purchase={recovery.purchase}
        busy={recovery.busy}
        canManage={canManage}
        error={recovery.error}
        onResume={recovery.resume}
        onCancel={recovery.cancel}
        onCheckPayment={recovery.check}
        choosingPro={choosingPro}
      />
    )
  return (
    <div className="space-y-3 p-6">
      <output className="block text-sm">
        {recovery.busy
          ? "Checking for an unfinished credit purchase…"
          : "Check your existing payment before starting another purchase."}
      </output>
      {recovery.error ? (
        <p role="alert" className="text-sm text-destructive">
          {recovery.error}
        </p>
      ) : null}
      <Button disabled={recovery.busy || !canManage} onClick={recovery.check}>
        Check purchase status
      </Button>
      {onCheckProStatus ? (
        <Button
          disabled={recovery.busy || !canManage}
          onClick={onCheckProStatus}
        >
          Check Pro payment status
        </Button>
      ) : null}
    </div>
  )
}
