"use client"

import { Badge, cn } from "@superserve/ui"

import {
  billingCredits,
  currencyCode,
  formatCurrency,
} from "@/components/billing-summary"
import { CornerBrackets } from "@/components/corner-brackets"
import type { BillingPlan, BillingSummaryResponse } from "@/lib/api/billing"

const EYEBROW =
  "font-mono text-[10px] font-semibold tracking-[0.18em] text-muted uppercase"

const shortDate = (value: string) =>
  new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })

function priceLabel(plan: BillingPlan, currency: string): string {
  if (plan.price_usd == null || plan.billing_interval_months == null) {
    return "Pay as you go"
  }
  const price = formatCurrency(plan.price_usd, currency).replace(/\.00$/, "")
  if (plan.billing_interval_months === 1) return `${price} / month`
  if (plan.billing_interval_months === 12) return `${price} / year`
  return `${price} every ${plan.billing_interval_months} months`
}

function creditNote(
  plan: BillingPlan | undefined,
  remaining: number | null,
  currency: string,
): string {
  const included = plan?.included_usage
  if (included) {
    const amount = formatCurrency(included.amount_usd, currency).replace(
      /\.00$/,
      "",
    )
    const period = `${shortDate(included.period_start)} – ${shortDate(included.period_end)}`
    if (included.status === "issued") {
      return `Includes ${amount} for ${period}. Unused credit expires.`
    }
    if (included.status === "pending") {
      return `${amount} for ${period} is being added.`
    }
    return `${amount} for ${period} is added once payment is confirmed.`
  }
  if (remaining == null) return "Credit balance couldn't be loaded."
  return remaining > 0
    ? "Applied automatically to your usage."
    : "Usage is billed at standard rates."
}

export function CurrentPlan({ summary }: { summary: BillingSummaryResponse }) {
  const plan = summary.plan
  const currency = currencyCode(summary)
  const remaining = billingCredits(summary).remaining
  return (
    <section
      aria-label="Plan and credits"
      className="relative mx-auto grid w-full max-w-4xl border border-dashed border-border bg-surface/40 sm:grid-cols-2"
      data-testid="current-plan"
    >
      <CornerBrackets size="sm" className="border-brand/70" />
      <div className="space-y-3 p-5 sm:p-6">
        <div className="flex items-center gap-2">
          <p className={EYEBROW}>Plan</p>
          {plan?.status === "pending" ? (
            <Badge variant="warning">Awaiting payment</Badge>
          ) : null}
        </div>
        {/* A missing plan means the API didn't report it, not that it's Free. */}
        <p
          className={cn(
            "text-3xl font-medium tracking-tight",
            plan ? "text-foreground" : "text-muted",
          )}
        >
          {plan?.name ?? "Unavailable"}
        </p>
        <p className="text-sm text-muted">
          {plan
            ? priceLabel(plan, currency)
            : "Plan details couldn't be loaded."}
        </p>
      </div>
      <div className="space-y-3 border-t border-dashed border-border p-5 sm:border-t-0 sm:border-l sm:p-6">
        <p className={EYEBROW}>Credits remaining</p>
        <p
          className={cn(
            "text-3xl tracking-tight",
            remaining == null
              ? "font-medium text-muted"
              : "font-mono font-semibold tabular-nums",
            remaining != null &&
              (remaining > 0 ? "text-brand" : "text-foreground"),
          )}
        >
          {remaining == null
            ? "Unavailable"
            : formatCurrency(remaining, currency)}
        </p>
        <p className="text-sm text-muted">
          {creditNote(plan, remaining, currency)}
        </p>
      </div>
    </section>
  )
}
