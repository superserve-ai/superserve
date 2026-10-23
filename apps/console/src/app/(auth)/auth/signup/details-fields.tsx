"use client"

import { cn, Input } from "@superserve/ui"

import { CornerBrackets } from "@/components/corner-brackets"
import {
  billingDetail,
  catalogPlan,
  creditDetail,
  limitDetails,
  monthlyPrice,
  type PlanCatalog,
} from "@/lib/api/plan-catalog"
import type { PlanCadence, PlanFamily } from "@/lib/api/signup-plan"
import type { RequestedOffer } from "@/lib/auth/requested-offer"
import {
  SIGNUP_PLAN_LABELS,
  signupDetailsOffer,
  type SignupAffiliation,
  type SignupPlanChoice,
} from "@/lib/auth/signup-review"

export interface SignupDetailsValues {
  company: string
  affiliation: SignupAffiliation | ""
  ycLink: string
  plan: SignupPlanChoice
  cadence: PlanCadence
}

export function initialSignupDetails(
  offer: RequestedOffer | undefined,
): SignupDetailsValues {
  const values: SignupDetailsValues = {
    company: "",
    affiliation: "",
    ycLink: "",
    plan: "pro",
    cadence: "monthly",
  }
  if (offer === "enterprise") values.plan = "enterprise"
  const match = offer?.match(/^(starter|pro)_(monthly|annual)$/)
  if (match) {
    values.plan = match[1] as SignupPlanChoice
    values.cadence = match[2] as PlanCadence
  }
  return values
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === "https:" || url.protocol === "http:"
  } catch {
    return false
  }
}

/** Client-side mirror of the server schema, for inline errors. */
export function validateSignupDetails(values: SignupDetailsValues) {
  const errors: Record<string, string> = {}
  const ycLink = values.ycLink.trim()
  if (values.affiliation === "yc" && ycLink && !isHttpUrl(ycLink))
    errors.ycLink = "Enter a valid http(s) URL."
  return errors
}

export function signupDetailsPayload(values: SignupDetailsValues) {
  const company = values.company.trim()
  const ycLink = values.ycLink.trim()
  return {
    ...(company ? { company } : {}),
    ...(values.affiliation ? { affiliation: values.affiliation } : {}),
    ...(values.affiliation === "yc" && ycLink ? { ycLink } : {}),
    plan: values.plan,
    ...(values.plan !== "enterprise" ? { cadence: values.cadence } : {}),
  }
}

export function signupValuesOffer(values: SignupDetailsValues): RequestedOffer {
  return signupDetailsOffer({ plan: values.plan, cadence: values.cadence })
}

const DESCRIPTIONS: Record<SignupPlanChoice, string> = {
  starter: "For small teams getting their first agents into production.",
  pro: "For teams running agents in production at scale.",
  enterprise: "For teams that need self-hosting and dedicated support.",
}

const ENTERPRISE_FEATURES = [
  "Self-host in your AWS, GCP, or Azure account",
  "Custom concurrency and sandbox sizes",
  "Dedicated support",
]

function planFeatures(
  catalog: PlanCatalog,
  family: PlanFamily,
  cadence: PlanCadence,
): string[] {
  const plan = catalogPlan(catalog, family, cadence)
  const features = [creditDetail(plan), ...limitDetails(plan)].filter(
    (item): item is string => item !== null,
  )
  if (family === "pro") features.push("Priority support")
  return features
}

function PlanPrice({
  catalog,
  plan,
  cadence,
}: {
  catalog: PlanCatalog
  plan: SignupPlanChoice
  cadence: PlanCadence
}) {
  const entry =
    plan === "enterprise" ? null : catalogPlan(catalog, plan, cadence)
  const price = entry ? monthlyPrice(entry) : "Custom"
  // Unpublished prices are left out rather than guessed.
  const note = entry
    ? (billingDetail(entry) ??
      `Billed ${cadence === "annual" ? "annually" : "monthly"}`)
    : "Volume pricing available"
  return (
    <span className="mt-8 block min-h-16">
      {price ? (
        <span className="block text-3xl leading-none font-medium tracking-tight text-brand md:text-4xl">
          {price}
          {plan !== "enterprise" ? (
            <span className="ml-1 font-mono text-[11px] tracking-[0.12em] text-muted uppercase">
              / month
            </span>
          ) : null}
        </span>
      ) : null}
      <span className="mt-3 block font-mono text-[11px] tracking-[0.12em] text-muted uppercase">
        {note}
      </span>
    </span>
  )
}

/** Pricing cards; the choice only records interest for staff review. */
export function PlanInterestCards({
  values,
  catalog,
  disabled,
  onChange,
}: {
  values: SignupDetailsValues
  catalog: PlanCatalog
  disabled?: boolean
  onChange: <K extends keyof SignupDetailsValues>(
    key: K,
    value: SignupDetailsValues[K],
  ) => void
}) {
  return (
    <div>
      <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-end">
        <div>
          <h1 className="text-3xl font-medium tracking-tight md:text-4xl">
            Create your Superserve account
          </h1>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted">
            Choose the plan you&apos;re interested in. You won&apos;t be charged
            today.
          </p>
        </div>
        <fieldset className="flex shrink-0 items-center" disabled={disabled}>
          <legend className="sr-only">Billing frequency</legend>
          {(["monthly", "annual"] as const).map((cadence, index) => (
            <button
              key={cadence}
              type="button"
              aria-pressed={values.cadence === cadence}
              onClick={() => onChange("cadence", cadence)}
              className={cn(
                "border border-dashed px-4 py-2 font-mono text-[11px] tracking-[0.12em] uppercase transition-colors",
                index > 0 && "-ml-px",
                values.cadence === cadence
                  ? "z-10 border-brand bg-brand/10 text-brand"
                  : "border-border-strong text-muted hover:text-foreground",
              )}
            >
              {cadence}
            </button>
          ))}
        </fieldset>
      </div>
      <fieldset
        className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-3"
        disabled={disabled}
      >
        <legend className="sr-only">Plan you&apos;re interested in</legend>
        {(["starter", "pro", "enterprise"] as const).map((plan) => {
          const selected = values.plan === plan
          const features =
            plan === "enterprise"
              ? ENTERPRISE_FEATURES
              : planFeatures(catalog, plan, values.cadence)
          return (
            <label
              key={plan}
              className={cn(
                "relative flex cursor-pointer flex-col border border-dashed p-6 transition-colors has-focus-visible:ring-2 has-focus-visible:ring-border-focus md:p-8",
                selected
                  ? "border-brand bg-surface"
                  : "border-border bg-background hover:bg-surface",
              )}
            >
              <input
                type="radio"
                name="signup-plan"
                value={plan}
                aria-label={SIGNUP_PLAN_LABELS[plan]}
                checked={selected}
                onChange={() => onChange("plan", plan)}
                className="sr-only"
              />
              {selected ? (
                <CornerBrackets size="md" className="border-brand" />
              ) : null}
              <span className="flex items-center justify-between gap-3">
                <span className="text-2xl leading-none font-medium tracking-tight">
                  {SIGNUP_PLAN_LABELS[plan]}
                </span>
                <span
                  className={cn(
                    "font-mono text-[11px] tracking-[0.12em] uppercase",
                    selected ? "text-brand" : "text-transparent",
                  )}
                  aria-hidden={!selected}
                >
                  Interested
                </span>
              </span>
              <PlanPrice
                catalog={catalog}
                plan={plan}
                cadence={values.cadence}
              />
              <span className="mt-6 text-sm leading-relaxed text-muted md:min-h-[2lh]">
                {DESCRIPTIONS[plan]}
              </span>
              {features.length ? (
                <span className="mt-6 flex flex-col gap-3 border-t border-dashed border-border pt-6">
                  {features.map((feature) => (
                    <span key={feature} className="flex gap-2 text-sm">
                      <span className="text-brand" aria-hidden>
                        ✓
                      </span>
                      {feature}
                    </span>
                  ))}
                </span>
              ) : null}
            </label>
          )
        })}
      </fieldset>
    </div>
  )
}

export function SignupDetailsFields({
  values,
  errors,
  disabled,
  onChange,
}: {
  values: SignupDetailsValues
  errors: Record<string, string>
  disabled?: boolean
  onChange: <K extends keyof SignupDetailsValues>(
    key: K,
    value: SignupDetailsValues[K],
  ) => void
}) {
  return (
    <>
      <Input
        type="text"
        placeholder="Company (optional)"
        aria-label="Company (optional)"
        value={values.company}
        onChange={(e) => onChange("company", e.target.value)}
        error={errors.company}
        disabled={disabled}
      />
      <select
        aria-label="Affiliation (optional)"
        value={values.affiliation}
        onChange={(e) =>
          onChange("affiliation", e.target.value as SignupAffiliation | "")
        }
        disabled={disabled}
        className={cn(
          "h-9 w-full border border-input bg-background px-3 text-sm text-foreground focus:border-border-focus focus:ring-2 focus:ring-border-focus focus:outline-none",
          !values.affiliation && "text-muted",
        )}
      >
        <option value="">Affiliation (optional)</option>
        <option value="yc">YC</option>
        <option value="other">Other</option>
      </select>
      {values.affiliation === "yc" && (
        <Input
          type="url"
          inputMode="url"
          placeholder="YC validation link (optional)"
          aria-label="YC validation link (optional)"
          value={values.ycLink}
          onChange={(e) => onChange("ycLink", e.target.value)}
          error={errors.ycLink}
          disabled={disabled}
        />
      )}
    </>
  )
}
