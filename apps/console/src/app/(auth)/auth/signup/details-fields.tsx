"use client"

import { cn, Input } from "@superserve/ui"

import {
  billingDetail,
  catalogPlan,
  monthlyPrice,
  type PlanCatalog,
} from "@/lib/api/plan-catalog"
import type { PlanCadence } from "@/lib/api/signup-plan"
import type { RequestedOffer } from "@/lib/auth/requested-offer"
import {
  signupDetailsOffer,
  type SignupAffiliation,
  type SignupPlanChoice,
} from "@/lib/auth/signup-review"

export interface SignupDetailsValues {
  company: string
  affiliation: SignupAffiliation | ""
  ycLink: string
  plan: SignupPlanChoice | ""
  cadence: PlanCadence
}

export function initialSignupDetails(
  offer: RequestedOffer | undefined,
): SignupDetailsValues {
  const values: SignupDetailsValues = {
    company: "",
    affiliation: "",
    ycLink: "",
    plan: "",
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
  if (!values.company.trim()) errors.company = "Company is required."
  if (!values.affiliation) errors.affiliation = "Choose an affiliation."
  if (values.affiliation === "yc") {
    if (!values.ycLink.trim()) errors.ycLink = "YC validation link is required."
    else if (!isHttpUrl(values.ycLink.trim()))
      errors.ycLink = "Enter a valid http(s) URL."
  }
  if (!values.plan) errors.plan = "Choose a plan."
  return errors
}

export function signupDetailsPayload(values: SignupDetailsValues) {
  return {
    company: values.company,
    affiliation: values.affiliation,
    ...(values.affiliation === "yc" ? { ycLink: values.ycLink } : {}),
    plan: values.plan,
    ...(values.plan && values.plan !== "enterprise"
      ? { cadence: values.cadence }
      : {}),
  }
}

export function signupValuesOffer(
  values: SignupDetailsValues,
): RequestedOffer | undefined {
  return values.plan
    ? signupDetailsOffer({ plan: values.plan, cadence: values.cadence })
    : undefined
}

const PLAN_OPTIONS: Array<{ value: SignupPlanChoice; label: string }> = [
  { value: "starter", label: "Starter" },
  { value: "pro", label: "Pro" },
  { value: "enterprise", label: "Enterprise" },
]

function planPrice(
  catalog: PlanCatalog,
  plan: SignupPlanChoice,
  cadence: PlanCadence,
): string {
  if (plan === "enterprise") return "Custom pricing"
  const entry = catalogPlan(catalog, plan, cadence)
  const price = monthlyPrice(entry)
  if (!price) return "Pricing on request"
  const detail = cadence === "annual" ? billingDetail(entry) : null
  return detail ? `${price}/mo · ${detail}` : `${price}/mo`
}

export function SignupDetailsFields({
  values,
  errors,
  catalog,
  disabled,
  onChange,
}: {
  values: SignupDetailsValues
  errors: Record<string, string>
  catalog: PlanCatalog
  disabled?: boolean
  onChange: <K extends keyof SignupDetailsValues>(
    key: K,
    value: SignupDetailsValues[K],
  ) => void
}) {
  return (
    <div className="space-y-3">
      <Input
        type="text"
        placeholder="Company"
        aria-label="Company"
        value={values.company}
        onChange={(e) => onChange("company", e.target.value)}
        error={errors.company}
        disabled={disabled}
      />
      <div>
        <select
          aria-label="Affiliation"
          value={values.affiliation}
          onChange={(e) =>
            onChange("affiliation", e.target.value as SignupAffiliation | "")
          }
          disabled={disabled}
          aria-invalid={!!errors.affiliation}
          className={cn(
            "h-9 w-full border border-input bg-background px-3 text-sm text-foreground focus:border-border-focus focus:ring-2 focus:ring-border-focus focus:outline-none",
            !values.affiliation && "text-muted",
            errors.affiliation && "border-destructive",
          )}
        >
          <option value="" disabled>
            Affiliation
          </option>
          <option value="yc">YC</option>
          <option value="other">Other</option>
        </select>
        {errors.affiliation && (
          <p className="mt-1 text-xs text-destructive">{errors.affiliation}</p>
        )}
      </div>
      {values.affiliation === "yc" && (
        <Input
          type="url"
          inputMode="url"
          placeholder="YC validation link"
          aria-label="YC validation link"
          value={values.ycLink}
          onChange={(e) => onChange("ycLink", e.target.value)}
          error={errors.ycLink}
          disabled={disabled}
        />
      )}
      <fieldset disabled={disabled}>
        <legend className="mb-2 font-mono text-xs text-muted uppercase">
          Plan
        </legend>
        <div className="space-y-2">
          {PLAN_OPTIONS.map((option) => (
            <label
              key={option.value}
              className={cn(
                "flex cursor-pointer items-center justify-between gap-3 border border-dashed px-3 py-2 text-sm",
                values.plan === option.value ? "border-brand" : "border-border",
              )}
            >
              <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name="signup-plan"
                  value={option.value}
                  checked={values.plan === option.value}
                  onChange={() => onChange("plan", option.value)}
                  className="accent-brand"
                />
                {option.label}
              </span>
              <span className="text-right text-xs text-muted">
                {planPrice(catalog, option.value, values.cadence)}
              </span>
            </label>
          ))}
        </div>
        {errors.plan && (
          <p className="mt-1 text-xs text-destructive">{errors.plan}</p>
        )}
        {(values.plan === "starter" || values.plan === "pro") && (
          <div
            role="radiogroup"
            aria-label="Billing frequency"
            className="mt-3 flex gap-4 font-mono text-xs uppercase"
          >
            {(["monthly", "annual"] as const).map((cadence) => (
              <label
                key={cadence}
                className="flex cursor-pointer items-center gap-2"
              >
                <input
                  type="radio"
                  name="signup-cadence"
                  value={cadence}
                  checked={values.cadence === cadence}
                  onChange={() => onChange("cadence", cadence)}
                  className="accent-brand"
                />
                {cadence}
              </label>
            ))}
          </div>
        )}
      </fieldset>
    </div>
  )
}
