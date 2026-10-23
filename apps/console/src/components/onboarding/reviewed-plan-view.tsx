"use client"

import { Button } from "@superserve/ui"

import {
  billingDetail,
  catalogPlan,
  creditDetail,
  limitDetails,
  monthlyPrice,
  type PlanCatalog,
} from "@/lib/api/plan-catalog"
import type { PlanCadence, PlanFamily } from "@/lib/api/signup-plan"

import { Benefits, Card } from "./plan-selection-view"

export type ReviewedPlan = PlanFamily | "enterprise"

export interface ReviewedPlanViewProps {
  mode: "confirm" | "plans"
  plan: ReviewedPlan | null
  cadence: PlanCadence
  catalog: PlanCatalog
  busy: boolean
  error?: string | null
  onCadence: (cadence: PlanCadence) => void
  onContinue: (plan: ReviewedPlan) => void
  onChangePlan: () => void
}

const PLAN_NAMES: Record<ReviewedPlan, string> = {
  starter: "Starter",
  pro: "Pro",
  enterprise: "Enterprise",
}

function CadenceToggle({
  name,
  cadence,
  busy,
  onCadence,
}: {
  name: string
  cadence: PlanCadence
  busy: boolean
  onCadence: (cadence: PlanCadence) => void
}) {
  return (
    <fieldset
      className="mt-4 flex gap-4 font-mono text-xs uppercase"
      disabled={busy}
    >
      <legend className="sr-only">{name} billing frequency</legend>
      {(["monthly", "annual"] as const).map((value) => (
        <label key={value} className="flex cursor-pointer items-center gap-2">
          <input
            type="radio"
            name={`${name}-cadence`}
            value={value}
            checked={cadence === value}
            onChange={() => onCadence(value)}
            className="accent-brand"
          />
          {value}
        </label>
      ))}
    </fieldset>
  )
}

function PlanPrice({
  catalog,
  family,
  cadence,
}: {
  catalog: PlanCatalog
  family: PlanFamily
  cadence: PlanCadence
}) {
  const plan = catalogPlan(catalog, family, cadence)
  const price = monthlyPrice(plan)
  const detail = billingDetail(plan)
  return (
    <div className="mt-4 min-h-16">
      {price ? (
        <p>
          <span className="text-4xl font-medium">{price}</span>
          <span className="text-muted-foreground ml-2 font-mono text-xs">
            / MONTH
          </span>
        </p>
      ) : (
        <p className="text-2xl font-medium">Pricing on request</p>
      )}
      {detail && (
        <p className="text-muted-foreground mt-2 font-mono text-xs uppercase">
          {detail}
        </p>
      )}
    </div>
  )
}

function PlanBenefits({
  catalog,
  family,
  cadence,
}: {
  catalog: PlanCatalog
  family: PlanFamily
  cadence: PlanCadence
}) {
  const plan = catalogPlan(catalog, family, cadence)
  const items = [creditDetail(plan), ...limitDetails(plan)].filter(
    (item): item is string => item !== null,
  )
  if (family === "pro") items.push("Priority support")
  if (!items.length) return null
  return (
    <div className="mt-8 border-t border-dashed border-border pt-6">
      <Benefits>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </Benefits>
    </div>
  )
}

function EnterpriseDetails() {
  return (
    <>
      <div className="mt-6 min-h-16">
        <p className="text-4xl font-medium">Custom</p>
        <p className="text-muted-foreground mt-2 font-mono text-xs uppercase">
          Volume pricing available
        </p>
      </div>
      <div className="mt-8 border-t border-dashed border-border pt-6">
        <Benefits>
          <li>Self-host in your AWS, GCP, or Azure account</li>
          <li>Custom concurrency and sandbox sizes</li>
          <li>Dedicated support</li>
        </Benefits>
        <p className="text-muted-foreground mt-6 text-xs leading-relaxed">
          Our team will reach out to set up your terms. You can start building
          right away.
        </p>
      </div>
    </>
  )
}

export function ReviewedPlanView(props: ReviewedPlanViewProps) {
  const { mode, plan, cadence, catalog, busy, error } = props
  const confirming = mode === "confirm" && plan !== null
  return (
    <main className="min-h-dvh bg-background px-5 py-10 text-foreground sm:px-10 sm:py-14">
      <div className="mx-auto max-w-6xl">
        <p className="mb-10 font-mono text-xs tracking-[0.2em] text-brand uppercase">
          Superserve
        </p>
        <h1 className="text-3xl font-medium tracking-tight sm:text-4xl">
          {confirming ? "Finish setting up your plan." : "Choose your plan."}
        </h1>
        <p className="text-muted-foreground mt-4 max-w-2xl">
          {confirming
            ? "Your account is approved. Confirm the plan you chose at signup to get started."
            : "Pick the plan that fits your team."}
        </p>

        {error ? (
          <div
            role="alert"
            className="mt-6 border border-dashed border-destructive/50 p-4 text-sm"
          >
            {error}
          </div>
        ) : null}

        {confirming ? (
          <div className="mt-10 max-w-xl">
            <Card title={PLAN_NAMES[plan]} selected>
              {plan === "enterprise" ? (
                <EnterpriseDetails />
              ) : (
                <>
                  <p className="text-muted-foreground mt-2 font-mono text-xs uppercase">
                    Billed {cadence}
                  </p>
                  <PlanPrice
                    catalog={catalog}
                    family={plan}
                    cadence={cadence}
                  />
                  <PlanBenefits
                    catalog={catalog}
                    family={plan}
                    cadence={cadence}
                  />
                </>
              )}
              <Button
                className="mt-8 w-full"
                disabled={busy}
                onClick={() => props.onContinue(plan)}
              >
                {plan === "enterprise" ? "Continue" : "Continue to payment"}
              </Button>
              <button
                type="button"
                className="text-muted-foreground mt-4 text-sm underline underline-offset-4 disabled:opacity-50"
                disabled={busy}
                onClick={props.onChangePlan}
              >
                Change plan
              </button>
            </Card>
          </div>
        ) : (
          <div className="mt-10 grid gap-5 lg:grid-cols-3">
            {(["starter", "pro"] as const).map((family) => (
              <Card
                key={family}
                title={PLAN_NAMES[family]}
                selected={plan === family}
              >
                <CadenceToggle
                  name={PLAN_NAMES[family]}
                  cadence={cadence}
                  busy={busy}
                  onCadence={props.onCadence}
                />
                <PlanPrice
                  catalog={catalog}
                  family={family}
                  cadence={cadence}
                />
                <Button
                  className="mt-6 w-full"
                  disabled={busy}
                  onClick={() => props.onContinue(family)}
                >
                  Continue to payment
                </Button>
                <PlanBenefits
                  catalog={catalog}
                  family={family}
                  cadence={cadence}
                />
              </Card>
            ))}
            <Card title="Enterprise" selected={plan === "enterprise"}>
              <Button
                className="mt-6 w-full"
                variant="outline"
                disabled={busy}
                onClick={() => props.onContinue("enterprise")}
              >
                Continue with Enterprise
              </Button>
              <EnterpriseDetails />
            </Card>
          </div>
        )}
      </div>
    </main>
  )
}
