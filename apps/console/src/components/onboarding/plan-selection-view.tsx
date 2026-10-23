"use client"

import { Button, cn } from "@superserve/ui"
import type { ReactNode } from "react"

import { CornerBrackets } from "@/components/corner-brackets"
import {
  formatUsdCents,
  planCard,
  planSandboxSize,
  type PublicBillingPlans,
} from "@/lib/billing/plans"

export type PlanCadence = "monthly" | "annual"
export type PlanStep = "plans" | "free-billing" | "payment-pending"

export interface PlanSelectionViewProps {
  step: PlanStep
  selection: "free" | "pro"
  cadence: PlanCadence
  busy: boolean
  error?: string | null
  plans?: PublicBillingPlans | null
  onCadence: (cadence: PlanCadence) => void
  onFree: () => void
  onPro: () => void
  onEnterprise: () => void
  onAddCard: () => void
  onSkip: () => void
  onBack: () => void
  onCheckPayment: () => void
  onCancelPayment: () => void
}

function Benefits({ children }: { children: ReactNode }) {
  return (
    <ul className="text-muted-foreground space-y-4 text-sm leading-relaxed [&>li]:flex [&>li]:gap-3 [&>li]:before:text-brand [&>li]:before:content-['✓']">
      {children}
    </ul>
  )
}

function Card({
  title,
  selected = false,
  children,
}: {
  title: string
  selected?: boolean
  children: ReactNode
}) {
  return (
    <section
      aria-label={`${title} plan`}
      className={cn(
        "bg-card relative flex flex-col border border-dashed p-6 sm:p-8",
        selected ? "border-brand" : "border-border",
      )}
    >
      {selected ? <CornerBrackets size="sm" /> : null}
      <h2 className="text-2xl font-medium tracking-tight">{title}</h2>
      {children}
    </section>
  )
}

function SignupCredit({ plans }: { plans?: PublicBillingPlans | null }) {
  if (!plans)
    return <li>Signup credit to start, plus more when you add billing</li>
  return (
    <li>
      {formatUsdCents(plans.signup.trial_credit_cents)} to start, plus{" "}
      {formatUsdCents(plans.signup.card_bonus_cents)} when you add billing, if
      eligible
    </li>
  )
}

function annualSavings(monthly: number, annual: number): number {
  return Math.round((1 - annual / (monthly * 12)) * 100)
}

export function PlanSelectionView(props: PlanSelectionViewProps) {
  const { step, selection, cadence, busy, error, plans } = props
  const choosing = step === "plans"
  const pending = step === "payment-pending"
  const pro = planCard(plans, "pro")
  const enterprise = planCard(plans, "enterprise")
  const proPrice = cadence === "annual" ? pro?.annual : pro?.monthly
  const proSavings =
    pro?.monthly && pro.annual
      ? annualSavings(pro.monthly.price_cents, pro.annual.price_cents)
      : 0
  const proSize = pro ? planSandboxSize(pro.limits) : null
  const trial = plans ? formatUsdCents(plans.signup.trial_credit_cents) : null
  const bonus = plans ? formatUsdCents(plans.signup.card_bonus_cents) : null
  return (
    <main className="min-h-dvh bg-background px-5 py-10 text-foreground sm:px-10 sm:py-14">
      <div className="mx-auto max-w-6xl">
        <p className="mb-10 font-mono text-xs tracking-[0.2em] text-brand uppercase">
          Superserve
        </p>
        <nav aria-label="Account setup progress" className="mb-12">
          <ol className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
            {["Create account", "Choose plan", "Billing"].map(
              (label, index) => {
                const active = index === (choosing ? 1 : 2)
                const complete = index < (choosing ? 1 : 2)
                return (
                  <li
                    key={label}
                    aria-current={active ? "step" : undefined}
                    className={cn(
                      "flex items-center gap-3",
                      active ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "flex size-8 items-center justify-center border border-dashed font-mono text-xs",
                        active || complete
                          ? "border-brand text-brand"
                          : "border-border",
                      )}
                    >
                      {complete ? "✓" : index + 1}
                    </span>
                    <span>
                      {label}
                      {index === 2 && !pending ? (
                        <span className="text-muted-foreground ml-1 text-xs">
                          (optional for Free)
                        </span>
                      ) : null}
                    </span>
                  </li>
                )
              },
            )}
          </ol>
        </nav>

        <h1 className="text-3xl font-medium tracking-tight sm:text-4xl">
          {choosing
            ? "Choose your plan."
            : pending
              ? "We’re checking your payment"
              : "You’re almost ready."}
        </h1>
        <p className="text-muted-foreground mt-4 max-w-2xl">
          {choosing
            ? "Start small or build at scale. Choose the plan that fits your team."
            : pending
              ? "Your account is ready. We’re confirming your Pro payment before finishing setup."
              : `Add a payment method for pay-as-you-go usage, or start with your ${trial ? `${trial} ` : ""}trial credit. No subscription fee.`}
        </p>

        {error ? (
          <div
            role="alert"
            className="mt-6 border border-dashed border-destructive/50 p-4 text-sm"
          >
            {error}
          </div>
        ) : null}

        {choosing ? (
          <div className="mt-10 grid gap-5 lg:grid-cols-3">
            <Card title="Free" selected={selection === "free"}>
              <div className="mt-6 min-h-24">
                <p className="text-4xl font-medium">$0</p>
                <p className="text-muted-foreground mt-2 font-mono text-xs uppercase">
                  Pay as you go after credit
                </p>
              </div>
              <p className="text-muted-foreground min-h-16 text-sm leading-relaxed">
                Everything you need to build and ship your first agents.
              </p>
              <Button
                className="mt-6 w-full"
                variant="outline"
                disabled={busy}
                onClick={props.onFree}
              >
                Continue with Free
              </Button>
              <div className="mt-8 border-t border-dashed border-border pt-6">
                <Benefits>
                  <SignupCredit plans={plans} />
                  <li>Up to 20 concurrent sandboxes</li>
                  <li>No time limit on sandboxes</li>
                  <li>Standard usage rates after credit</li>
                  <li>Up to 2 vCPU, 2 GiB memory, 8 GiB disk per sandbox</li>
                </Benefits>
              </div>
            </Card>

            <Card title={pro?.name ?? "Pro"} selected={selection === "pro"}>
              <fieldset
                className="mt-4 flex gap-4 font-mono text-xs uppercase"
                disabled={busy}
              >
                <legend className="sr-only">
                  {pro?.name ?? "Pro"} billing frequency
                </legend>
                {(["monthly", "annual"] as const).map((value) => (
                  <label
                    key={value}
                    className="flex cursor-pointer items-center gap-2"
                  >
                    <input
                      type="radio"
                      name="pro-cadence"
                      value={value}
                      checked={cadence === value}
                      onChange={() => props.onCadence(value)}
                      className="accent-brand"
                    />
                    {value}
                  </label>
                ))}
              </fieldset>
              <div className="mt-4 min-h-16">
                {proPrice ? (
                  <>
                    <p>
                      <span className="text-4xl font-medium">
                        {formatUsdCents(proPrice.monthly_equivalent_cents)}
                      </span>
                      <span className="text-muted-foreground ml-2 font-mono text-xs">
                        / MONTH
                      </span>
                    </p>
                    <p className="text-muted-foreground mt-2 font-mono text-xs uppercase">
                      {cadence === "annual"
                        ? `${formatUsdCents(proPrice.price_cents)} billed annually${proSavings > 0 ? ` · Save ${proSavings}%` : ""}`
                        : `${formatUsdCents(proPrice.price_cents)} billed monthly`}
                    </p>
                  </>
                ) : (
                  <p className="text-muted-foreground font-mono text-xs uppercase">
                    {plans === undefined
                      ? "Pricing is loading"
                      : "Pricing is unavailable. Reload or contact our team."}
                  </p>
                )}
              </div>
              <p className="text-muted-foreground mt-2 min-h-16 text-sm leading-relaxed">
                {pro?.tagline ||
                  "For teams running agents in production at scale."}
              </p>
              <Button
                className="mt-6 w-full"
                disabled={busy || !proPrice?.available}
                onClick={props.onPro}
              >
                Continue to payment
              </Button>
              <div className="mt-8 border-t border-dashed border-border pt-6">
                <p className="mb-4 text-sm font-medium">
                  Everything in Free, plus:
                </p>
                <Benefits>
                  {pro ? (
                    <li>
                      {pro.monthly_credit_cents
                        ? `${formatUsdCents(pro.monthly_credit_cents)} in metered usage included each month`
                        : `Included usage: ${pro.credit_summary}`}
                    </li>
                  ) : null}
                  {pro?.features.map((feature, index) => (
                    <li key={`${index}-${feature}`}>{feature}</li>
                  ))}
                  {pro?.limits.max_sandboxes ? (
                    <li>
                      Up to {pro.limits.max_sandboxes.toLocaleString("en-US")}{" "}
                      concurrent sandboxes
                    </li>
                  ) : null}
                  {proSize ? <li>{proSize}</li> : null}
                </Benefits>
                <p className="text-muted-foreground mt-6 text-xs leading-relaxed">
                  Free signup credits do not stack with Pro. Usage beyond the
                  included amount is billed at standard rates.
                </p>
              </div>
            </Card>

            <Card title={enterprise?.name ?? "Enterprise"}>
              <div className="mt-6 min-h-24">
                <p className="text-4xl font-medium">Custom</p>
                <p className="text-muted-foreground mt-2 font-mono text-xs uppercase">
                  Volume pricing available
                </p>
              </div>
              <p className="text-muted-foreground min-h-16 text-sm leading-relaxed">
                {enterprise?.tagline ||
                  "For teams that need self-hosting and dedicated support."}
              </p>
              <Button
                className="mt-6 w-full"
                variant="outline"
                disabled={busy}
                onClick={props.onEnterprise}
              >
                Contact sales
                <span className="sr-only"> (opens in a new tab)</span>
              </Button>
              <div className="mt-8 border-t border-dashed border-border pt-6">
                <p className="mb-4 text-sm font-medium">
                  Everything in Pro, plus:
                </p>
                <Benefits>
                  {enterprise?.features.map((feature, index) => (
                    <li key={`${index}-${feature}`}>{feature}</li>
                  ))}
                </Benefits>
                <p className="text-muted-foreground mt-6 text-xs leading-relaxed">
                  Continue on Free while you talk with our team.
                </p>
              </div>
            </Card>
          </div>
        ) : pending ? (
          <section
            aria-label="Payment confirmation"
            className="bg-card mt-10 max-w-2xl border border-dashed border-border p-6 sm:p-8"
          >
            <output className="text-muted-foreground text-sm leading-relaxed">
              You won’t be asked to pay again while this payment is being
              checked. To change plans, we first need to confirm that your
              previous payment cannot complete.
            </output>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button
                className="h-auto min-h-9 w-full py-2 whitespace-normal sm:w-auto"
                disabled={busy}
                onClick={props.onCheckPayment}
              >
                {busy ? "Checking…" : "Check payment status"}
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={props.onCancelPayment}
                className="h-auto min-h-9 w-full py-2 whitespace-normal sm:w-auto"
              >
                Cancel checkout and change plan
              </Button>
            </div>
            <p className="text-muted-foreground mt-6 text-sm">
              Still waiting?{" "}
              <a
                className="text-brand underline underline-offset-4"
                href="https://www.superserve.ai/meet/"
                target="_blank"
                rel="noopener noreferrer"
              >
                Contact our team
              </a>
              . You can return to this page to check again.
            </p>
          </section>
        ) : (
          <section
            aria-label="Free billing setup"
            className="bg-card mt-10 max-w-2xl border border-dashed border-border p-6 sm:p-8"
          >
            <h2 className="text-xl font-medium">Free · Pay as you go</h2>
            <p className="text-muted-foreground mt-4 text-sm leading-relaxed">
              Adding a payment method activates pay-as-you-go billing and
              replaces your {trial ? `${trial} ` : ""}trial with{" "}
              {bonus ? `${bonus} in ` : ""}promotional credit, if eligible. You
              can also skip and add billing later.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button disabled={busy} onClick={props.onAddCard}>
                Add payment method
              </Button>
              <Button variant="outline" disabled={busy} onClick={props.onSkip}>
                Skip for now
              </Button>
            </div>
            <button
              type="button"
              className="text-muted-foreground mt-6 text-sm underline underline-offset-4 disabled:opacity-50"
              disabled={busy}
              onClick={props.onBack}
            >
              Back to plans
            </button>
          </section>
        )}
      </div>
    </main>
  )
}
