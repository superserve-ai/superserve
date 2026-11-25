import type { BillingSummaryResponse } from "@/lib/api/billing"
import type { BillingCapabilities } from "@/lib/api/billing-capabilities"
import { ApiError } from "@/lib/api/client"

export type BillingActionState = Pick<
  BillingSummaryResponse,
  "billing_mode" | "permissions" | "checkout_available" | "portal_available"
> &
  Partial<Pick<BillingSummaryResponse, "payment_setup_required">>

export function billingAccountState(
  summary: BillingSummaryResponse | undefined,
  summaryError: unknown,
  capabilities: BillingCapabilities | undefined,
): BillingActionState | null {
  if (!capabilities) return null
  if (
    summaryError instanceof ApiError &&
    [401, 403].includes(summaryError.status)
  )
    return null
  const account = capabilities.account
  // Absent is an older API; explicit null is a failed metadata read.
  if (account === null) return null
  const current = summaryError ? undefined : summary
  if (!account) return current ?? null
  if (!current)
    return {
      ...account,
      permissions: {
        can_view: account.permissions.can_view,
        can_manage:
          account.permissions.can_view && account.permissions.can_manage,
      },
      checkout_available:
        account.billing_mode === "live" && account.checkout_available,
      portal_available:
        account.billing_mode === "live" && account.portal_available,
    }
  const live =
    current.billing_mode === "live" && account.billing_mode === "live"
  return {
    billing_mode: live ? "live" : "shadow",
    permissions: {
      can_view: current.permissions.can_view && account.permissions.can_view,
      can_manage:
        current.permissions.can_manage &&
        account.permissions.can_manage &&
        current.permissions.can_view &&
        account.permissions.can_view,
    },
    checkout_available:
      live && current.checkout_available && account.checkout_available,
    portal_available:
      live && current.portal_available && account.portal_available,
    payment_setup_required: current.payment_setup_required,
  }
}
