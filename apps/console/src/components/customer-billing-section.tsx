"use client"

import {
  ArrowSquareOutIcon,
  CreditCardIcon,
  SpinnerGapIcon,
} from "@phosphor-icons/react"
import { Alert, Button } from "@superserve/ui"
import { useQueryClient } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"

import {
  EYEBROW,
  billingCredits,
  formatCurrency,
} from "@/components/billing-summary"
import { useBillingPayment } from "@/hooks/use-billing-payment"
import { useCustomerBillingPeriods } from "@/hooks/use-customer-billing"
import type { BillingSummaryResponse } from "@/lib/api/billing"
import { billingKeys } from "@/lib/api/query-keys"

interface CustomerBillingSectionProps {
  teamId: string
  teamRegion: string
  teamName: string
  summary: BillingSummaryResponse | null | undefined
  cardless?: boolean
}

function friendlyPeriodStatus(status: string): string {
  if (status === "active" || status === "exported" || status === "approved") {
    return "Live"
  }
  if (status === "validating") {
    return "Under review"
  }
  if (status === "pending" || status === "processing") {
    return "Pending"
  }
  return status
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ")
}

function billingModeCopy(
  mode: BillingSummaryResponse["billing_mode"] | null | undefined,
) {
  if (mode === "shadow") {
    return {
      title: "Tracking only",
      message:
        "Usage is tracked at standard rates, but this team is not charged yet.",
      variant: "warning" as const,
    }
  }

  return null
}

function noticeFromQuery(value: string | null) {
  if (value === "success") {
    return {
      variant: "default" as const,
      title: "Returned from Stripe",
      message: "Billing status is refreshing against the latest server state.",
    }
  }
  if (value === "cancel") {
    return {
      variant: "warning" as const,
      title: "Billing flow canceled",
      message:
        "No changes were made. You can reopen billing setup or the customer portal any time.",
    }
  }
  if (value === "portal-return") {
    return {
      variant: "default" as const,
      title: "Billing portal closed",
      message:
        "You returned from Stripe customer portal. Billing settings remain available here.",
    }
  }
  return null
}

function paymentSummary(
  summary:
    | {
        billing_mode?: "shadow" | "live"
        payment_setup_required?: boolean
        portal_available?: boolean
      }
    | null
    | undefined,
  period:
    | {
        stripe_subscription_id?: string
        stripe_subscription_status?: string
        stripe_invoice_status?: string
        cancel_at_period_end?: boolean
      }
    | null
    | undefined,
): {
  headline: string
  detail: string
} {
  if (summary?.payment_setup_required) {
    return {
      headline: "Payment setup required",
      detail: "Start checkout to connect Stripe for this team.",
    }
  }

  if (summary?.billing_mode === "shadow") {
    return {
      headline: "Tracked only",
      detail: "Usage is being tracked, but this team is not being charged yet.",
    }
  }

  if (summary?.portal_available) {
    if (period?.cancel_at_period_end) {
      return {
        headline: "Connected",
        detail:
          "Billing is scheduled to end at the close of the current period.",
      }
    }

    if (period?.stripe_invoice_status === "open") {
      return {
        headline: "Connected",
        detail: "Stripe is ready to invoice this team.",
      }
    }

    return {
      headline: "Connected",
      detail: period?.stripe_invoice_status
        ? `Invoice status: ${friendlyPeriodStatus(period.stripe_invoice_status)}`
        : "Stripe subscription details are available for this team.",
    }
  }

  if (!summary) {
    return {
      headline: "Unavailable",
      detail: "Billing data is unavailable for this team right now.",
    }
  }

  return summary.billing_mode === "live"
    ? {
        headline: "Billing unavailable",
        detail:
          "Billing is live, but no customer portal is currently available.",
      }
    : {
        headline: "Tracking only",
        detail: "Usage is tracked, but billing actions are not available yet.",
      }
}

export function CustomerBillingSection({
  teamId,
  teamRegion,
  teamName,
  summary,
  cardless = false,
}: CustomerBillingSectionProps) {
  const queryClient = useQueryClient()
  const [notice, setNotice] = useState<ReturnType<typeof noticeFromQuery>>()

  const teamKey = `${teamRegion}:${teamId}`
  const { submitting, available, openSession } = useBillingPayment(
    cardless && summary
      ? { ...summary, checkout_available: false, payment_setup_required: false }
      : summary,
    teamKey,
  )
  const periodsQuery = useCustomerBillingPeriods(teamId, teamKey)
  const latestPeriod = useMemo(() => {
    return (
      periodsQuery.data?.periods?.toSorted((a, b) => {
        const endDiff =
          new Date(b.period_end).getTime() - new Date(a.period_end).getTime()
        if (endDiff !== 0) return endDiff
        return (
          new Date(b.period_start).getTime() -
          new Date(a.period_start).getTime()
        )
      })[0] ?? null
    )
  }, [periodsQuery.data?.periods])

  useEffect(() => {
    const query = new URLSearchParams(window.location.search)
    const billingState = query.get("billing")
    setNotice(noticeFromQuery(billingState))
    if (billingState) {
      query.delete("billing")
      const nextUrl = new URL(window.location.href)
      nextUrl.search = query.toString()
      window.history.replaceState({}, "", nextUrl.toString())
      void queryClient.invalidateQueries({
        queryKey: billingKeys.all,
      })
    }
  }, [queryClient])

  const payment = paymentSummary(summary, latestPeriod)
  const successfulPayment =
    payment.headline === "Connected" &&
    !periodsQuery.error &&
    latestPeriod !== null &&
    ["active", "exported", "approved"].includes(latestPeriod.status) &&
    !latestPeriod.blocked_reason &&
    !latestPeriod.cancel_at_period_end &&
    (!latestPeriod?.stripe_invoice_status ||
      latestPeriod.stripe_invoice_status === "paid") &&
    latestPeriod.stripe_subscription_status === "active"
  const modeCopy = billingModeCopy(summary?.billing_mode)
  const canManageBilling = Boolean(summary?.permissions?.can_manage)
  const canOpenPortal = Boolean(summary?.portal_available)
  const canStartCheckout = Boolean(summary?.checkout_available)
  const billingActionAvailable = canOpenPortal || canStartCheckout

  const manageLabel = canOpenPortal
    ? "Open Customer Portal"
    : canStartCheckout
      ? "Set Up Billing"
      : null

  const isActionDisabled =
    submitting !== null ||
    periodsQuery.isPending ||
    periodsQuery.isFetching ||
    !canManageBilling ||
    !billingActionAvailable ||
    !available

  const actionButton =
    canManageBilling && manageLabel ? (
      <Button
        size="sm"
        onClick={() => void openSession()}
        disabled={isActionDisabled}
      >
        {submitting ? (
          <SpinnerGapIcon className="size-3.5 animate-spin" weight="light" />
        ) : canOpenPortal ? (
          <ArrowSquareOutIcon className="size-3.5" weight="light" />
        ) : (
          <CreditCardIcon className="size-3.5" weight="light" />
        )}
        {submitting || periodsQuery.isPending || periodsQuery.isFetching
          ? "Loading..."
          : manageLabel}
      </Button>
    ) : null

  if (cardless) {
    const credits = summary ? billingCredits(summary) : null
    const showCredits = credits?.remaining != null && credits.remaining !== 0
    const showEstimate = credits?.payable != null && credits.payable !== 0
    const showPortal = canOpenPortal && canManageBilling
    if (!showPortal && !showCredits && !showEstimate) return null
    return (
      <section
        className="mx-auto flex w-full max-w-4xl flex-wrap items-center justify-between gap-3 border border-dashed border-border bg-surface/40 px-5 py-3.5"
        aria-label="Billing account"
        data-testid="customer-billing-section"
      >
        <div className="min-w-0 space-y-1">
          <p className={EYEBROW}>Billing account</p>
          {showCredits ? (
            <p className="text-sm text-foreground">
              Credits remaining: {formatCurrency(credits.remaining ?? 0)}
            </p>
          ) : null}
          {showEstimate ? (
            <p className="text-sm text-foreground">
              Current billing period estimate:{" "}
              {formatCurrency(credits.payable ?? 0)}
            </p>
          ) : null}
        </div>
        {showPortal ? actionButton : null}
      </section>
    )
  }

  // Shadow mode is explained by its own notice, so its payment headline is
  // not repeated in the payments row.
  const showPaymentStatus =
    !successfulPayment && payment.headline !== "Tracked only"
  const viewOnly = !canManageBilling && summary
  const showPaymentsRow = showPaymentStatus || actionButton || viewOnly
  if (!showPaymentsRow && !modeCopy && !notice && !latestPeriod?.blocked_reason)
    return null

  return (
    <section
      className="mx-auto w-full max-w-4xl space-y-3"
      aria-label={`Payments for ${teamName}`}
      data-testid="customer-billing-section"
    >
      {modeCopy && (
        <Alert variant={modeCopy.variant} title={modeCopy.title}>
          {modeCopy.message}
        </Alert>
      )}

      {notice && (
        <Alert variant={notice.variant} title={notice.title}>
          {notice.message}
        </Alert>
      )}

      {latestPeriod?.blocked_reason && (
        <Alert variant="warning" title="Billing setup pending">
          {latestPeriod.blocked_reason}
        </Alert>
      )}

      {showPaymentsRow ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border border-dashed border-border bg-surface/40 px-5 py-3.5">
          <div className="min-w-0 space-y-1">
            <p className={EYEBROW}>
              {showPaymentStatus ? "Payment Status" : "Payments"}
            </p>
            {showPaymentStatus ? (
              <>
                <p className="text-sm font-medium text-foreground">
                  {payment.headline}
                </p>
                <p className="text-xs text-muted">{payment.detail}</p>
                {latestPeriod?.cancel_at_period_end && (
                  <p className="text-xs text-muted">
                    Cancel at period end: yes
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-muted">
                Payment details and invoices are in the customer portal.
              </p>
            )}
          </div>
          {actionButton ??
            (viewOnly ? (
              <p className="text-xs text-muted">
                Billing is view-only for your role.
              </p>
            ) : null)}
        </div>
      ) : null}
    </section>
  )
}
