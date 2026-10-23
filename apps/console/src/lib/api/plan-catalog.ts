import type { PlanCadence, PlanFamily, PurchaseOffer } from "./signup-plan"

// Promotional credit for adding a card on the default pay-as-you-go plan. It
// replaces the trial credit rather than adding to it.
export const CARD_BONUS_USD = 95
export const TRIAL_CREDIT_USD = 5

export interface CatalogPlan {
  key: PurchaseOffer
  family: PlanFamily
  name: string
  interval_months: number
  // Null when the price is not published yet; the UI omits the number.
  price_cents: number | null
  monthly_credit_cents: number | null
  limits: {
    max_sandboxes: number | null
    max_template_vcpu: number | null
    max_template_memory_mib: number | null
    max_template_disk_mib: number | null
  }
}

export type PlanCatalog = Record<PurchaseOffer, CatalogPlan>

const PRO_LIMITS = {
  max_sandboxes: 1000,
  max_template_vcpu: 16,
  max_template_memory_mib: 64 * 1024,
  max_template_disk_mib: 64 * 1024,
}

const UNKNOWN_LIMITS = {
  max_sandboxes: null,
  max_template_vcpu: null,
  max_template_memory_mib: null,
  max_template_disk_mib: null,
}

// Used for any plan the billing API does not list (it only lists plans that
// are currently purchasable) or when it is unreachable. Unknown numbers stay
// null rather than guessed.
export const FALLBACK_PLAN_CATALOG: PlanCatalog = {
  starter_monthly: {
    key: "starter_monthly",
    family: "starter",
    name: "Starter",
    interval_months: 1,
    price_cents: 10_000,
    monthly_credit_cents: null,
    limits: UNKNOWN_LIMITS,
  },
  starter_annual: {
    key: "starter_annual",
    family: "starter",
    name: "Starter",
    interval_months: 12,
    price_cents: null,
    monthly_credit_cents: null,
    limits: UNKNOWN_LIMITS,
  },
  pro_monthly: {
    key: "pro_monthly",
    family: "pro",
    name: "Pro",
    interval_months: 1,
    price_cents: 120_000,
    monthly_credit_cents: 100_000,
    limits: PRO_LIMITS,
  },
  pro_annual: {
    key: "pro_annual",
    family: "pro",
    name: "Pro",
    interval_months: 12,
    price_cents: 1_200_000,
    monthly_credit_cents: 100_000,
    limits: PRO_LIMITS,
  },
}

export function catalogPlan(
  catalog: PlanCatalog,
  family: PlanFamily,
  cadence: PlanCadence,
): CatalogPlan {
  return catalog[`${family}_${cadence}`]
}

function dollars(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  })}`
}

/** Per-month headline price, e.g. "$1,000"; null when unpublished. */
export function monthlyPrice(plan: CatalogPlan): string | null {
  if (plan.price_cents === null || plan.interval_months < 1) return null
  return dollars(Math.round(plan.price_cents / plan.interval_months))
}

/** Billing detail line, e.g. "$12,000 billed annually"; null when unpublished. */
export function billingDetail(plan: CatalogPlan): string | null {
  if (plan.price_cents === null) return null
  return plan.interval_months === 12
    ? `${dollars(plan.price_cents)} billed annually`
    : `${dollars(plan.price_cents)} billed monthly`
}

export function creditDetail(plan: CatalogPlan): string | null {
  return plan.monthly_credit_cents === null
    ? null
    : `${dollars(plan.monthly_credit_cents)} in metered usage included each month`
}

function gib(mib: number): string {
  return `${Math.round(mib / 1024)} GiB`
}

export function limitDetails(plan: CatalogPlan): string[] {
  const { limits } = plan
  const details: string[] = []
  if (limits.max_sandboxes !== null)
    details.push(
      `Up to ${limits.max_sandboxes.toLocaleString("en-US")} concurrent sandboxes`,
    )
  const size = [
    limits.max_template_vcpu !== null && `${limits.max_template_vcpu} vCPU`,
    limits.max_template_memory_mib !== null &&
      `${gib(limits.max_template_memory_mib)} memory`,
    limits.max_template_disk_mib !== null &&
      `${gib(limits.max_template_disk_mib)} disk`,
  ].filter(Boolean)
  if (size.length) details.push(`Up to ${size.join(", ")} per sandbox`)
  return details
}
