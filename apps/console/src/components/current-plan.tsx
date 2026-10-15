"use client"

import { Badge, Card, CardContent } from "@superserve/ui"

import { formatCurrency, formatPeriodDate } from "@/components/billing-summary"
import type { BillingIncludedUsage, BillingPlan } from "@/lib/api/billing"

function priceLabel(plan: BillingPlan, currency: string): string {
  if (plan.price_usd == null || plan.billing_interval_months == null) {
    return "No subscription fee"
  }
  const price = formatCurrency(plan.price_usd, currency)
  if (plan.billing_interval_months === 1) return `${price} / month`
  if (plan.billing_interval_months === 12) return `${price} / year`
  return `${price} every ${plan.billing_interval_months} months`
}

function includedUsageDetail(included: BillingIncludedUsage): string {
  const expires = formatPeriodDate(included.period_end)
  if (included.status === "issued") {
    return `Applied to usage until ${expires}. Unused credit does not roll over.`
  }
  if (included.status === "pending") {
    return "Being added to your account."
  }
  return "Not added for this period yet. It is added once your plan payment is confirmed and no invoices are overdue."
}

export function CurrentPlan({
  plan,
  currency,
}: {
  plan: BillingPlan
  currency: string
}) {
  const included = plan.included_usage
  return (
    <Card
      className="border-border/70 bg-background/60"
      data-testid="current-plan"
    >
      <CardContent className="grid gap-4 p-4 sm:grid-cols-2">
        <div className="space-y-2">
          <p className="font-mono text-[10px] font-semibold tracking-wide text-muted uppercase">
            Current Plan
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-base font-semibold text-foreground">
              {plan.name}
            </p>
            {plan.status === "pending" ? (
              <Badge variant="warning">Awaiting payment</Badge>
            ) : null}
          </div>
          <p className="text-sm text-muted">{priceLabel(plan, currency)}</p>
        </div>

        <div className="space-y-2">
          <p className="font-mono text-[10px] font-semibold tracking-wide text-muted uppercase">
            Included Usage
          </p>
          {included ? (
            <>
              <p className="text-sm font-medium text-foreground">
                {formatCurrency(included.amount_usd, currency)} for{" "}
                {formatPeriodDate(included.period_start)} -{" "}
                {formatPeriodDate(included.period_end)}
              </p>
              <p className="text-xs text-muted">
                {includedUsageDetail(included)}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted">
              {plan.key === "free"
                ? "None. Usage is billed at standard rates."
                : "No included usage for the current period."}
            </p>
          )}
          {plan.key !== "free" ? (
            <p className="text-xs text-muted">
              Usage beyond included credit is billed at standard rates.
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
