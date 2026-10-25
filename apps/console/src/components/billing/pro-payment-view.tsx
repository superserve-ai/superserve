"use client"

import { Button } from "@superserve/ui"
import Link from "next/link"

import { CornerBrackets } from "@/components/corner-brackets"
import {
  formatUsdCents,
  planCard,
  planSandboxSize,
  type PlanCard,
  type PublicBillingPlans,
} from "@/lib/billing/plans"

export type ProPaymentStep =
  | "loading"
  | "unavailable"
  | "offer"
  | "confirming"
  | "conflict"
  | "subscribed"
  | "team_mismatch"

export function proPaymentStep(state: {
  loading: boolean
  plans?: PublicBillingPlans
  paidPlan?: string | null
  conflict: boolean
  confirming: boolean
  teamMismatch?: boolean
}): ProPaymentStep {
  if (state.loading) return "loading"
  if (state.teamMismatch) return "team_mismatch"
  if (state.confirming) return "confirming"
  if (state.paidPlan) return "subscribed"
  if (
    state.plans?.pricing_version !== "v2" ||
    !planCard(state.plans, "pro")?.monthly?.available
  )
    return "unavailable"
  if (state.conflict) return "conflict"
  return "offer"
}

export interface ProPaymentViewProps {
  step: ProPaymentStep
  pro?: PlanCard
  paidPlan?: string | null
  busy: boolean
  canceled: boolean
  error?: string | null
  onContinue: () => void
  onCheckPayment: () => void
}

export function ProPaymentView({
  step,
  pro,
  paidPlan,
  busy,
  canceled,
  error,
  onContinue,
  onCheckPayment,
}: ProPaymentViewProps) {
  if (step === "loading")
    return <p className="text-muted-foreground p-6 text-sm">Loading Pro…</p>
  if (step === "team_mismatch")
    return (
      <div className="space-y-3 p-6">
        <p className="text-sm" role="alert">
          Switch to the team you used for checkout to check this payment. If
          this return link has no team, open Billing for that team.
        </p>
        <Link href="/plan-usage/" className="text-sm underline">
          Go to Billing
        </Link>
      </div>
    )
  if (step === "subscribed")
    return (
      <div className="space-y-3 p-6">
        <p className="text-sm">
          Your team is on {paidPlan ?? "a paid plan"}. Manage it, your payment
          method and invoices in Billing.
        </p>
        <Link href="/plan-usage/" className="text-sm underline">
          Go to Billing
        </Link>
      </div>
    )
  if (step === "confirming")
    return (
      <div className="space-y-3 p-6">
        <output className="block text-sm">
          We’re confirming your payment. This usually takes a few seconds.
        </output>
        <Button disabled={busy} onClick={onCheckPayment}>
          Check again
        </Button>
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    )
  if (step === "unavailable" || !pro?.monthly)
    return (
      <div className="space-y-3 p-6">
        <p className="text-sm">Pro isn’t available to buy here right now.</p>
        <Link href="/plan-usage" className="text-sm underline">
          Back to billing
        </Link>
      </div>
    )
  if (step === "conflict")
    return (
      <div className="space-y-3 p-6">
        <p className="text-sm" role="alert">
          This team already has a paid plan or a payment in progress.
        </p>
        <Link href="/plan-usage" className="text-sm underline">
          View your plan
        </Link>
      </div>
    )
  const size = planSandboxSize(pro.limits)
  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-6">
      <section
        aria-label="Pro plan"
        className="bg-card relative border border-dashed border-brand p-6 sm:p-8"
      >
        <CornerBrackets size="sm" />
        <h2 className="text-2xl font-medium tracking-tight">{pro.name}</h2>
        <p className="mt-2 text-3xl">
          {formatUsdCents(pro.monthly.price_cents)}
          <span className="text-muted-foreground text-sm"> / month</span>
        </p>
        <ul className="text-muted-foreground mt-6 space-y-3 text-sm">
          <li>{pro.credit_summary}</li>
          <li>Usage beyond that is billed monthly at normal rates</li>
          {pro.limits.max_concurrent ? (
            <li>
              {pro.limits.max_concurrent.toLocaleString("en-US")} sandboxes
              running at once
            </li>
          ) : null}
          {size ? <li>{size}</li> : null}
          {pro.features.map((feature) => (
            <li key={feature}>{feature}</li>
          ))}
        </ul>

        <div className="mt-8 space-y-3">
          {canceled ? (
            <p className="text-muted-foreground text-sm">
              Payment was canceled. You can try again whenever you’re ready.
            </p>
          ) : null}
          <Button disabled={busy} onClick={onContinue}>
            Continue to payment
          </Button>
          <p className="text-muted-foreground text-xs">
            Have a promotion code? Enter it on the payment page. It applies to
            your first invoice.
          </p>
        </div>
        {error ? (
          <p className="mt-4 text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </section>
    </div>
  )
}
