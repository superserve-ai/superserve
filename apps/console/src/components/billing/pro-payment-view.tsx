"use client"

import { Button } from "@superserve/ui"
import Link from "next/link"

import { CornerBrackets } from "@/components/corner-brackets"
import type { ProCheckout } from "@/lib/api/billing-v2"
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

// A team already on a paid plan is sent to manage it, whether or not Pro is
// on sale, so turning pricing v2 off never hides a paying customer's plan.
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
  quoteUnavailable?: boolean
  onRetryQuote?: () => void
  proCheckout?: ProCheckout
  pro?: PlanCard
  paidPlan?: string | null
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
  proCheckout,
  quoteUnavailable = false,
  onRetryQuote,
  paidPlan,
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
  if (step === "confirming")
    return (
      <div className="space-y-3 p-6">
        <output className="block text-sm">
          Payment status is pending. Check again to continue the saved checkout
          or confirm its payment.
        </output>
        <ProCheckoutTerms
          pro={pro}
          checkout={proCheckout}
          unavailable={quoteUnavailable}
        />
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
  if (proCheckout?.accepted)
    return (
      <section aria-label="Saved Pro checkout" className="space-y-3 p-6">
        <h2 className="text-lg font-medium">Your saved Pro checkout</h2>
        <ProCheckoutTerms
          checkout={proCheckout}
          unavailable={quoteUnavailable}
        />
        {canceled ? (
          <p className="text-sm">
            You left the payment page. Check the saved checkout to continue or
            confirm its status.
          </p>
        ) : null}
        <Button disabled={busy || !canRecover} onClick={onCheckPayment}>
          Continue saved checkout
        </Button>
        <Link href="/plan-usage/" className="text-sm underline">
          View your plan
        </Link>
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </section>
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
        <p className="mt-2 text-3xl">
          {formatUsdCents(pro.monthly.price_cents)}
          <span className="text-muted-foreground text-sm"> / month</span>
        </p>
        <ul className="text-muted-foreground mt-6 space-y-3 text-sm">
          <ProCheckoutTerms
            pro={pro}
            checkout={proCheckout}
            unavailable={quoteUnavailable}
            asList
          />
          <li>Pro limits begin after payment is confirmed.</li>
          <li>
            Your regular {formatUsdCents(pro.monthly.price_cents)} monthly fee
            and included credit{" "}
            {proCheckout?.first_paid_pro_cycle
              ? "renew at the end of each billing month."
              : "begin on your next billing date."}
          </li>
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
          {!canContinue ? (
            <p className="text-sm text-muted">
              Only billing administrators can start payment.
            </p>
          ) : null}
          {quoteUnavailable ? (
            <Button disabled={busy} onClick={onRetryQuote}>
              Retry payment terms
            </Button>
          ) : null}
          <Button
            disabled={busy || !canContinue || quoteUnavailable}
            onClick={onContinue}
          >
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

function quoteDate(value: string) {
  return new Date(value).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  })
}

function ProCheckoutTerms({
  pro,
  checkout,
  asList = false,
  unavailable = false,
}: {
  pro?: PlanCard
  checkout?: ProCheckout
  asList?: boolean
  unavailable?: boolean
}) {
  let terms: React.ReactNode
  if (unavailable) {
    terms = (
      <>We couldn’t load your first-payment terms. Retry before continuing.</>
    )
  } else if (checkout?.accepted) {
    terms = (
      <>
        {checkout.first_payment_cents !== undefined ? (
          <>
            First payment: {formatUsdCents(checkout.first_payment_cents)} before
            any promotion discount.{" "}
          </>
        ) : null}
        {checkout.first_credit_cents !== undefined ? (
          <>
            Included usage credit: {formatUsdCents(checkout.first_credit_cents)}
            .{" "}
          </>
        ) : null}
        {checkout.period_start && checkout.period_end ? (
          <>
            This payment covers {quoteDate(checkout.period_start)} to{" "}
            {quoteDate(checkout.period_end)}.{" "}
          </>
        ) : null}
        {checkout.credit_expires_at ? (
          <>
            This credit expires {quoteDate(checkout.credit_expires_at)} and does
            not roll over.
          </>
        ) : !checkout.first_paid_pro_cycle ? (
          <>This first payment’s usage credit does not expire.</>
        ) : null}
      </>
    )
  } else if (checkout?.first_paid_pro_cycle && pro?.monthly) {
    terms = (
      <>
        Your first full month of Pro costs{" "}
        {formatUsdCents(pro.monthly.price_cents)} before any promotion discount.
        Your monthly billing cycle starts when you upgrade.{" "}
        {pro.monthly_credit_cents !== null ? (
          <>
            You receive {formatUsdCents(pro.monthly_credit_cents)} in usage
            credit for that month.{" "}
          </>
        ) : null}
        This credit expires at the end of that billing month and does not roll
        over.
      </>
    )
  } else if (asList) {
    terms = (
      <>
        Pay once for the rest of your current billing period and receive the
        prorated non-expiring usage credit based on your selected plan.
      </>
    )
  } else return null
  return asList ? (
    <li>{terms}</li>
  ) : (
    <p className="text-muted-foreground text-sm">{terms}</p>
  )
}
