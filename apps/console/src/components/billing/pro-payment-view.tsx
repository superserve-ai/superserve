"use client"

import { Button } from "@superserve/ui"
import Link from "next/link"

import { CornerBrackets } from "@/components/corner-brackets"
import type { ProCheckoutTerms } from "@/lib/api/billing-v2"
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
  | "completed"
  | "conflict"
  | "subscribed"
  | "team_mismatch"

// A team already on a paid plan is sent to manage it, whether or not Pro is
// on sale, so turning pricing v2 off never hides a paying customer's plan.
export function proPaymentStep(state: {
  loading: boolean
  entryOpen?: boolean
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
    state.entryOpen === false ||
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
  checkoutTerms?: ProCheckoutTerms
  busy: boolean
  canContinue?: boolean
  canRecover?: boolean
  canceled: boolean
  error?: string | null
  onContinue: () => void
  onCheckPayment: () => void
}

export function ProPaymentView({
  step,
  pro,
  paidPlan,
  checkoutTerms,
  busy,
  canContinue = true,
  canRecover = true,
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
  if (step === "completed")
    return (
      <div className="space-y-3 p-6">
        <output className="block text-sm">
          Payment is confirmed.{" "}
          {busy ? "Refreshing your plan…" : "Check again to refresh your plan."}
        </output>
        <Button disabled={busy || !canRecover} onClick={onCheckPayment}>
          Check again
        </Button>
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    )
  if (step === "confirming")
    return (
      <div className="space-y-3 p-6">
        <output className="block text-sm">
          Payment status is pending. Check again to continue the saved checkout
          or confirm its payment.
        </output>
        <Button disabled={busy || !canRecover} onClick={onCheckPayment}>
          Check again
        </Button>
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    )
  if (step === "unavailable" || !pro?.monthly || step === "conflict")
    return (
      <div className="space-y-3 p-6">
        <p className="text-sm" role={step === "conflict" ? "alert" : undefined}>
          {step === "conflict"
            ? "This team already has a paid plan or a payment in progress."
            : "Pro isn’t available to buy here right now."}
        </p>
        <Button disabled={busy || !canRecover} onClick={onCheckPayment}>
          Check payment status
        </Button>
        <Link href="/plan-usage/" className="text-sm underline">
          View your plan
        </Link>
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
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
        {checkoutTerms?.accepted ? (
          <p className="mt-2 text-sm">Saved checkout terms</p>
        ) : (
          <p className="mt-2 text-3xl">
            {formatUsdCents(pro.monthly.price_cents)}
            <span className="text-muted-foreground text-sm"> / month</span>
          </p>
        )}
        <ul className="text-muted-foreground mt-6 space-y-3 text-sm">
          <ProCheckoutCopy terms={checkoutTerms} pro={pro} />
          <li>Pro limits begin after payment is confirmed.</li>
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
          {!canContinue ? (
            <p className="text-sm text-muted">
              Only billing administrators can start payment.
            </p>
          ) : null}
          <Button disabled={busy || !canContinue} onClick={onContinue}>
            Continue to payment
          </Button>
          <Button
            disabled={busy || !canRecover}
            onClick={onCheckPayment}
            variant="outline"
          >
            Check payment status
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

function checkoutDate(value: string): string {
  return (
    new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    }).format(new Date(value)) + " UTC"
  )
}

function ProCheckoutCopy({
  terms,
  pro,
}: {
  terms?: ProCheckoutTerms
  pro: PlanCard
}) {
  if (terms?.accepted) {
    const {
      period_start: start,
      period_end: end,
      first_payment_cents: payment,
      first_credit_cents: credit,
      credit_expires_at: expiry,
    } = terms
    // Incomplete or contradictory accepted terms must never fall back to a live catalog quote.
    if (
      start &&
      end &&
      payment !== undefined &&
      credit !== undefined &&
      Date.parse(start) < Date.parse(end) &&
      (terms.first_paid_pro_cycle ? expiry === end : expiry === undefined)
    ) {
      return (
        <>
          <li>
            Your saved initial payment before discounts is{" "}
            {formatUsdCents(payment)} for {checkoutDate(start)} through{" "}
            {checkoutDate(end)}.
          </li>
          <li>
            {formatUsdCents(credit)} in included usage credit{" "}
            {expiry
              ? `expires on ${checkoutDate(expiry)}.`
              : "is prorated for this billing period and never expires."}
          </li>
          <li>
            {terms.first_paid_pro_cycle
              ? "Your first paid billing month is shown above. "
              : "Your existing billing date is preserved. "}
            Your next billing date is {checkoutDate(end)}. Confirm discounts and
            the amount due on the secure payment page.
          </li>
        </>
      )
    }
  } else if (terms?.first_paid_pro_cycle && pro.monthly) {
    return (
      <>
        <li>
          Your first payment covers a full billing month. The monthly plan fee
          is {formatUsdCents(pro.monthly.price_cents)} before discounts.
        </li>
        {pro.monthly_credit_cents !== null ? (
          <li>
            Your plan includes {formatUsdCents(pro.monthly_credit_cents)} in
            usage credit each billing month. Unused monthly credit expires at
            the end of that billing month.
          </li>
        ) : null}
        <li>
          Your monthly renewal date is set when you start Pro. Confirm your
          initial amount, included credit and renewal date on the secure payment
          page.
        </li>
      </>
    )
  }
  return (
    <li>
      The secure payment page confirms your initial payment amount, included
      usage credit and renewal date before you pay.
    </li>
  )
}
