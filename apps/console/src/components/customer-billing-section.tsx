"use client"

import {
  ArrowSquareOutIcon,
  CreditCardIcon,
  SpinnerGapIcon,
  WarningIcon,
} from "@phosphor-icons/react"
import { Alert, Button } from "@superserve/ui"
import { useQueryClient } from "@tanstack/react-query"
import { type ReactNode, useEffect, useMemo, useState } from "react"

import {
  EYEBROW,
  billingCredits,
  formatCurrency,
} from "@/components/billing-summary"
import { useBillingPayment } from "@/hooks/use-billing-payment"
import { useCustomerBillingPeriods } from "@/hooks/use-customer-billing"
import type { BillingSummaryResponse } from "@/lib/api/billing"
import type { CustomerBillingPeriodResponse } from "@/lib/api/billing-stripe"
import { billingKeys } from "@/lib/api/query-keys"

interface CustomerBillingSectionProps {
  teamId: string
  teamRegion: string
  teamName: string
  summary: BillingSummaryResponse | null | undefined
  cardless?: boolean
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

// The plan card shows a payment status line only when billing needs
// attention. A connected team in its normal state shows no line. Shadow mode
// is explained by its own notice, so it adds no line either.
export function billingProblem(
  summary:
    | Pick<
        BillingSummaryResponse,
        "billing_mode" | "payment_setup_required" | "portal_available"
      >
    | null
    | undefined,
  period:
    | Pick<
        CustomerBillingPeriodResponse,
        | "status"
        | "cancel_at_period_end"
        | "stripe_subscription_status"
        | "stripe_invoice_status"
      >
    | null
    | undefined,
): string | null {
  if (!summary) return null
  if (summary.payment_setup_required)
    return "Payment setup required. Start checkout to connect Stripe for this team."
  if (summary.billing_mode === "shadow") return null
  if (!summary.portal_available)
    return summary.billing_mode === "live"
      ? "Billing is live, but no customer portal is currently available."
      : "Usage is tracked, but billing actions are not available yet."
  if (!period) return null
  if (period.cancel_at_period_end)
    return "Billing is scheduled to end at the close of the current period."
  const subscription = period.stripe_subscription_status
  if (subscription === "past_due" || subscription === "unpaid")
    return "The last payment failed. Update your payment method in the customer portal."
  if (subscription === "incomplete" || subscription === "incomplete_expired")
    return "The subscription is waiting for payment confirmation."
  if (subscription === "canceled") return "The subscription is canceled."
  if (period.stripe_invoice_status === "uncollectible")
    return "The latest invoice could not be collected. Update your payment method in the customer portal."
  if (period.status === "failed")
    return "Billing for the current period failed."
  if (["pending", "processing", "validating"].includes(period.status))
    return "Billing for the current period is still processing."
  return null
}

function useLatestBillingPeriod(
  teamId: string | null,
  teamKey: string | null,
  enabled = true,
) {
  const periodsQuery = useCustomerBillingPeriods(teamId, teamKey, 8, enabled)
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
  return { periodsQuery, latestPeriod }
}

function useBillingAction(
  teamId: string | null,
  teamKey: string | null,
  summary: BillingSummaryResponse | null | undefined,
  cardless: boolean,
  enabled = true,
) {
  const { submitting, available, openSession } = useBillingPayment(
    cardless && summary
      ? { ...summary, checkout_available: false, payment_setup_required: false }
      : summary,
    teamKey,
  )
  const { periodsQuery, latestPeriod } = useLatestBillingPeriod(
    teamId,
    teamKey,
    enabled,
  )
  const canManageBilling = Boolean(summary?.permissions?.can_manage)
  const canOpenPortal = Boolean(summary?.portal_available)
  const canStartCheckout = !cardless && Boolean(summary?.checkout_available)

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
    !(canOpenPortal || canStartCheckout) ||
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

  return { actionButton, canManageBilling, canOpenPortal, latestPeriod }
}

// The payment action and any billing problem, shown inside the plan card.
// A hook, so the page owns the payment request while the plan card changes
// layout; a null team or `enabled: false` renders nothing.
export function usePlanBillingControls({
  team,
  summary,
  enabled = true,
}: {
  team: { teamId: string; region: string } | null
  summary: BillingSummaryResponse | null | undefined
  enabled?: boolean
}): ReactNode {
  const active = enabled && !!team
  const { actionButton, canManageBilling, latestPeriod } = useBillingAction(
    team?.teamId ?? null,
    team ? `${team.region}:${team.teamId}` : null,
    summary,
    false,
    active,
  )
  const problem = billingProblem(summary, latestPeriod)
  const viewOnly = !canManageBilling && Boolean(summary)
  if (!active || (!actionButton && !viewOnly && !problem)) return null

  return (
    <div className="space-y-3" data-testid="plan-billing-controls">
      {problem ? (
        <p
          className="flex items-start gap-2 text-xs text-warning"
          data-testid="plan-billing-problem"
        >
          <WarningIcon className="mt-px size-3.5 shrink-0" weight="light" />
          <span>{problem}</span>
        </p>
      ) : null}
      {actionButton ??
        (viewOnly ? (
          <p className="text-xs text-muted">
            Billing is view-only for your role.
          </p>
        ) : null)}
    </div>
  )
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

  const { actionButton, canManageBilling, canOpenPortal, latestPeriod } =
    useBillingAction(teamId, `${teamRegion}:${teamId}`, summary, cardless)

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

  const modeCopy = billingModeCopy(summary?.billing_mode)

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

  // The payment status and action live in the plan card. This section keeps
  // only the notices that need the full width.
  if (!modeCopy && !notice && !latestPeriod?.blocked_reason) return null

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
    </section>
  )
}
