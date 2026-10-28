"use client"

import { Button, cn } from "@superserve/ui"
import type { ReactNode } from "react"

import { CornerBrackets } from "@/components/corner-brackets"

export type PlanCadence = "monthly" | "annual"
export type PlanStep = "plans" | "payment-pending"

export interface PlanSelectionViewProps {
  step: PlanStep
  cadence: PlanCadence
  busy: boolean
  error?: string | null
  onCadence: (cadence: PlanCadence) => void
  onPro: () => void
  onEnterprise: () => void
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

export function PlanSelectionView(props: PlanSelectionViewProps) {
  const { step, cadence, busy, error } = props
  const choosing = step === "plans"
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
                    <span>{label}</span>
                  </li>
                )
              },
            )}
          </ol>
        </nav>

        <h1 className="text-3xl font-medium tracking-tight sm:text-4xl">
          {choosing ? "Choose your plan." : "We’re checking your payment"}
        </h1>
        <p className="text-muted-foreground mt-4 max-w-2xl">
          {choosing
            ? "Choose the plan that fits your team."
            : "Your account is ready. We’re confirming your Pro payment before finishing setup."}
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
          <div className="mt-10 grid gap-5 lg:grid-cols-2">
            <Card title="Pro" selected>
              <fieldset
                className="mt-4 flex gap-4 font-mono text-xs uppercase"
                disabled={busy}
              >
                <legend className="sr-only">Pro billing frequency</legend>
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
                <p>
                  <span className="text-4xl font-medium">
                    {cadence === "annual" ? "$1,000" : "$1,200"}
                  </span>
                  <span className="text-muted-foreground ml-2 font-mono text-xs">
                    / MONTH
                  </span>
                </p>
                <p className="text-muted-foreground mt-2 font-mono text-xs uppercase">
                  {cadence === "annual"
                    ? "$12,000 billed annually · Save 17%"
                    : "$1,200 billed monthly"}
                </p>
              </div>
              <p className="text-muted-foreground mt-2 min-h-16 text-sm leading-relaxed">
                For teams running agents in production at scale.
              </p>
              <Button
                className="mt-6 w-full"
                disabled={busy}
                onClick={props.onPro}
              >
                Continue to payment
              </Button>
              <div className="mt-8 border-t border-dashed border-border pt-6">
                <Benefits>
                  <li>$1,000 in metered usage included each month</li>
                  <li>Priority support</li>
                  <li>Up to 1,000 concurrent sandboxes</li>
                  <li>Up to 16 vCPU, 64 GiB memory, 64 GiB disk per sandbox</li>
                </Benefits>
                <p className="text-muted-foreground mt-6 text-xs leading-relaxed">
                  Usage beyond the included amount is billed at standard rates.
                </p>
              </div>
            </Card>

            <Card title="Enterprise">
              <div className="mt-6 min-h-24">
                <p className="text-4xl font-medium">Custom</p>
                <p className="text-muted-foreground mt-2 font-mono text-xs uppercase">
                  Volume pricing available
                </p>
              </div>
              <p className="text-muted-foreground min-h-16 text-sm leading-relaxed">
                For teams that need self-hosting and dedicated support.
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
                  <li>Self-host in your AWS, GCP, or Azure account</li>
                  <li>Custom concurrency and sandbox sizes</li>
                  <li>Dedicated support</li>
                </Benefits>
              </div>
            </Card>
          </div>
        ) : (
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
        )}
      </div>
    </main>
  )
}
