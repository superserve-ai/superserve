"use client"

import { Skeleton } from "@superserve/ui"

import { CornerBrackets } from "@/components/corner-brackets"
import { ErrorState } from "@/components/error-state"
import type { BillingSummaryResponse } from "@/lib/api/billing"
import { ApiError } from "@/lib/api/client"

const MIN_PROJECTION_ELAPSED_MS = 4 * 60 * 60 * 1000
export const MINUTE_MS = 60 * 1000
export const HOUR_MS = 60 * MINUTE_MS
export const DAY_MS = 24 * HOUR_MS

export function currencyCode(summary: BillingSummaryResponse): string {
  return summary.pricing_tier.currency || "USD"
}

export interface BillingCredits {
  applied: number | null
  remaining: number | null
  payable: number | null
}

// Picks the backend's authoritative credit figures; null means unknown, not $0.
export function billingCredits(
  summary: BillingSummaryResponse,
): BillingCredits {
  if (summary.credit_source === "stripe") {
    return {
      applied: summary.stripe_credits_applied_usd ?? null,
      remaining: summary.stripe_remaining_credit_usd ?? null,
      payable: summary.expected_invoice_amount_usd,
    }
  }
  return {
    applied: summary.credits_applied_usd,
    remaining: summary.credits_remaining_usd,
    payable: summary.expected_invoice_amount_usd,
  }
}

// The credit a team is shown as having left. A team still on its free trial
// spends the trial balance, the figure the trial banner and sandbox access
// use; the general credit fields can read $0 for it while the trial still has
// credit. Only for display: estimates keep the general credit figures.
export function creditsRemaining(
  summary: BillingSummaryResponse,
): number | null {
  const trial = summary.trial
  if (
    summary.plan?.key === "trial" &&
    trial?.state === "active" &&
    typeof trial.remaining_usd === "number"
  ) {
    return trial.remaining_usd
  }
  return billingCredits(summary).remaining
}

export function formatCurrency(value: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

export function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
}

export function formatPeriodDate(value: string): string {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })
}

export function formatCount(
  value: number,
  unit: "day" | "hour" | "minute",
): string {
  const rounded = Math.max(Math.round(value), 0)
  return `${rounded} ${unit}${rounded === 1 ? "" : "s"}`
}

export interface BillingCycleProgress {
  percentage: number
  elapsedMs: number
  remainingMs: number
  totalMs: number
}

export function getBillingCycleProgress(
  start: string,
  end: string,
  nowMs: number = Date.now(),
): BillingCycleProgress {
  const startMs = new Date(start).getTime()
  const endMs = new Date(end).getTime()
  const totalMs = Math.max(endMs - startMs, 0)
  const clampedNow = Math.min(Math.max(nowMs, startMs), endMs)
  const elapsedMs = Math.max(clampedNow - startMs, 0)
  const remainingMs = Math.max(endMs - clampedNow, 0)
  const percentage = totalMs > 0 ? (elapsedMs / totalMs) * 100 : 0

  return { percentage, elapsedMs, remainingMs, totalMs }
}

export function formatDurationRemaining(ms: number): string {
  const safeMs = Math.max(ms, 0)
  if (safeMs >= DAY_MS) return formatCount(safeMs / DAY_MS, "day")
  if (safeMs >= HOUR_MS) return formatCount(safeMs / HOUR_MS, "hour")
  if (safeMs >= MINUTE_MS) return formatCount(safeMs / MINUTE_MS, "minute")
  return "less than a minute"
}

export interface ProjectedPeriodEndEstimate {
  available: boolean
  projectedCharges: number | null
  estimatedCredits: number | null
  estimatedInvoice: number | null
}

export function getProjectedPeriodEndEstimate(
  summary: BillingSummaryResponse,
  nowMs: number = Date.now(),
): ProjectedPeriodEndEstimate {
  const progress = getBillingCycleProgress(
    summary.billing_period.start,
    summary.billing_period.end,
    nowMs,
  )

  if (progress.totalMs <= 0 || progress.elapsedMs < MIN_PROJECTION_ELAPSED_MS) {
    return {
      available: false,
      projectedCharges: null,
      estimatedCredits: null,
      estimatedInvoice: null,
    }
  }

  const projectedCharges =
    (summary.current_charges_usd * progress.totalMs) / progress.elapsedMs
  const credits = billingCredits(summary)
  // Without a payable figure the backend could not place the current period's
  // credit, so there is no credit total to project against.
  if (
    credits.applied == null ||
    credits.remaining == null ||
    credits.payable == null
  ) {
    return {
      available: true,
      projectedCharges,
      estimatedCredits: null,
      estimatedInvoice: null,
    }
  }
  // Remaining credit is net of credit already applied this period.
  const estimatedCredits = Math.min(
    Math.max(credits.applied + credits.remaining, 0),
    projectedCharges,
  )

  return {
    available: true,
    projectedCharges,
    estimatedCredits,
    estimatedInvoice: Math.max(projectedCharges - estimatedCredits, 0),
  }
}

export function billingErrorMessage(error: unknown): {
  title: string
  message: string
  suggestion?: string
} {
  if (error instanceof ApiError && error.status === 403) {
    return {
      title: "Billing Access Required",
      message: "Your account does not have billing read access for this team.",
      suggestion: "Ask a team owner to grant a billing role.",
    }
  }

  if (error instanceof ApiError && error.status === 401) {
    return {
      title: "Sign In Required",
      message: "Your session is missing or expired.",
      suggestion: "Sign in again to view billing.",
    }
  }

  return {
    title: "Billing Summary Unavailable",
    message:
      error instanceof Error
        ? error.message
        : "The billing summary could not be loaded.",
  }
}

export function BillingSummary({
  summary,
}: {
  summary: BillingSummaryResponse
}) {
  const currency = currencyCode(summary)
  const progress = getBillingCycleProgress(
    summary.billing_period.start,
    summary.billing_period.end,
  )
  const credits = billingCredits(summary)
  const estimate = getProjectedPeriodEndEstimate(summary)
  const money = (value: number | null) =>
    value == null ? "Unavailable" : formatCurrency(value, currency)

  return (
    <section
      className="relative mx-auto w-full max-w-4xl border border-dashed border-border bg-surface/40 p-5"
      aria-label="Billing summary"
      data-testid="billing-statement"
    >
      <CornerBrackets size="sm" className="border-brand/70" />
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm text-foreground">
          {formatPeriodDate(summary.billing_period.start)} -{" "}
          {formatPeriodDate(summary.billing_period.end)}
        </p>
        <p className="font-mono text-xs text-muted uppercase">
          {formatDurationRemaining(progress.remainingMs)} left
        </p>
      </div>
      <div aria-hidden className="mt-2 h-1 bg-foreground/10">
        <div
          className="h-full bg-brand"
          style={{ width: `${progress.percentage}%` }}
        />
      </div>

      <div className="mt-5 flex flex-wrap items-end justify-between gap-6 border-t border-dashed border-border pt-5">
        <div className="space-y-1">
          <p className={EYEBROW}>Cost so far</p>
          <p className="font-mono text-4xl font-semibold tracking-tight text-foreground">
            {formatCurrency(summary.current_charges_usd, currency)}
          </p>
          {credits.applied ? (
            <p className="font-mono text-xs text-muted">
              -{formatCurrency(Math.abs(credits.applied), currency)} credits
              applied · {money(credits.payable)} due
            </p>
          ) : null}
        </div>
        <dl className="flex gap-8">
          <HeadlineFigure
            label="Est. invoice"
            value={
              estimate.available
                ? money(estimate.estimatedInvoice)
                : "Not enough data"
            }
          />
          <HeadlineFigure
            label="Credits left"
            value={money(creditsRemaining(summary))}
          />
        </dl>
      </div>
    </section>
  )
}

export const EYEBROW =
  "font-mono text-[10px] font-semibold tracking-[0.18em] text-muted uppercase"

function HeadlineFigure({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <dt className={EYEBROW}>{label}</dt>
      <dd className="font-mono text-base text-foreground">{value}</dd>
    </div>
  )
}

export function BillingError({
  error,
  onRetry,
}: {
  error: unknown
  onRetry: () => void
}) {
  const details = billingErrorMessage(error)
  return (
    <ErrorState
      title={details.title}
      message={details.message}
      suggestion={details.suggestion}
      onRetry={onRetry}
    />
  )
}

export function BillingSkeleton() {
  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 border border-dashed border-border bg-surface/40 p-5">
      <div className="space-y-2">
        <Skeleton className="h-4 w-44" />
        <Skeleton className="h-1 w-full" />
      </div>
      <div className="flex items-end justify-between gap-6 border-t border-dashed border-border pt-5">
        <div className="space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-9 w-36" />
        </div>
        <div className="flex gap-8">
          <Skeleton className="h-9 w-20" />
          <Skeleton className="h-9 w-20" />
        </div>
      </div>
    </div>
  )
}
