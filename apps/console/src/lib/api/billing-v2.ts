import { z } from "zod"

import {
  type BillingOffer,
  findOffer,
  type FundingPolicy,
  fundingPolicySchema,
  planCardSchema,
  planKindSchema,
  planLimitsSchema,
  type PlanTopoff,
  planTopoffSchema,
} from "@/lib/billing/plans"
import {
  isAwaitingPlanState,
  type AwaitingPlanState,
} from "@/lib/billing/signup-checkout-paths"

export {
  describeSandboxSize,
  planKindSchema,
  planLimitsSchema,
} from "@/lib/billing/plans"

const cents = z.number().int().nonnegative()

export const proCheckoutTermsSchema = z.object({
  offer_key: z.string().optional().catch(undefined),
  first_paid_pro_cycle: z.boolean(),
  accepted: z.boolean(),
  period_start: z.string().datetime({ offset: true }).optional(),
  period_end: z.string().datetime({ offset: true }).optional(),
  credit_expires_at: z.string().datetime({ offset: true }).optional(),
  first_payment_cents: cents.safe().optional(),
  first_credit_cents: cents.safe().optional(),
})

export const proCheckoutResponseSchema = z.object({
  pro_checkout: proCheckoutTermsSchema.optional(),
})

export type ProCheckoutTerms = z.infer<typeof proCheckoutTermsSchema>

// Saved checkout terms describe the team's open checkout, which may be for
// another plan. A backend that doesn't name the offer predates any plan but
// Pro being sold here.
export function checkoutTermsFor(
  terms: ProCheckoutTerms | undefined,
  offerKey: string,
): ProCheckoutTerms | undefined {
  if (!terms?.accepted) return terms
  const matches = terms.offer_key
    ? terms.offer_key === offerKey
    : offerKey.startsWith("pro_")
  return matches ? terms : undefined
}

export const teamPlanSchema = z
  .object({
    plan: z
      .object({
        plan_key: z.string(),
        kind: planKindSchema,
        display_name: z.string(),
        limits: planLimitsSchema.extend({
          max_concurrent: z.number().int().nonnegative().nullable(),
          max_templates: z.number().int().nonnegative().nullable(),
        }),
        effective_from: z.string(),
        funding_policy: fundingPolicySchema.optional().catch(undefined),
        topoff: planTopoffSchema.optional().catch(undefined),
      })
      .nullable(),
    period: z.object({ start: z.string(), end: z.string() }),
    pro_checkout: proCheckoutTermsSchema.optional(),
    pending_change: z
      .object({
        id: z.string().uuid(),
        target_plan_key: z.string(),
        target_display_name: z.string(),
        effective_at: z.string(),
        undoable: z.boolean(),
        pauses_running: z.boolean(),
      })
      .nullable(),
  })
  .transform(({ plan, period, pending_change, pro_checkout }) =>
    plan === null
      ? null
      : {
          ...(pro_checkout ? { pro_checkout } : {}),
          key: plan.plan_key,
          kind: plan.kind,
          effective_from: plan.effective_from,
          name: plan.display_name,
          limits: plan.limits,
          ...(plan.funding_policy
            ? { funding_policy: plan.funding_policy }
            : {}),
          ...(plan.topoff !== undefined ? { topoff: plan.topoff } : {}),
          fee_cents: null as number | null,
          included_cents: null as number | null,
          period_start: period.start as string | null,
          period_end: period.end as string | null,
          pending_change: pending_change
            ? {
                id: pending_change.id,
                plan_key: pending_change.target_plan_key,
                plan_name: pending_change.target_display_name,
                effective_at: pending_change.effective_at,
                undoable: pending_change.undoable,
                pauses_running: pending_change.pauses_running,
              }
            : null,
        },
  )

// The new-team entry state from the plan read. Anything but a team that has
// not paid for a plan yet, including a backend without trials, is null.
export const teamEntrySchema = z
  .object({ entry_state: z.unknown().optional() })
  .transform(({ entry_state }): AwaitingPlanState | null =>
    isAwaitingPlanState(entry_state) ? entry_state : null,
  )

const decimalCents = z.number().nonnegative()

export const freeAllowanceSchema = z.object({
  applies: z.boolean(),
  window_started_at: z.string().nullable(),
  resets_at: z.string().nullable(),
  allowance_cents: decimalCents.nullable(),
  used_cents: decimalCents.nullable(),
  remaining_cents: decimalCents.nullable(),
  paused: z.boolean().nullable(),
  paused_reason: z.string().nullable(),
  as_of: z.string().nullable(),
})

export const prepaidBalanceSchema = z.object({
  balance_cents: z.number().int(),
  low_balance: z.boolean().optional(),
  balance_observed: z.boolean().optional().catch(undefined),
  auto_recharge: z.object({
    enabled: z.boolean(),
    threshold_cents: cents.nullable(),
    amount_cents: cents.nullable(),
    disabled_reason: z.string().nullable(),
    disabled_at: z.string().nullable(),
    in_flight: z.boolean(),
  }),
})

export type PlanKind = z.infer<typeof planKindSchema>
export type PlanLimits = z.infer<typeof planLimitsSchema>
export type TeamPlan = NonNullable<z.infer<typeof teamPlanSchema>>
export type FreeAllowance = z.infer<typeof freeAllowanceSchema>
export type PrepaidBalance = z.infer<typeof prepaidBalanceSchema>

export function isLowBalance(prepaid: PrepaidBalance): boolean {
  if (prepaid.balance_cents <= 0) return true
  return !prepaid.auto_recharge.enabled && prepaid.low_balance === true
}

// A balance the backend has not observed recently reads as $0, so it can't
// say the credit ran out.
export function balanceKnown(prepaid: PrepaidBalance): boolean {
  return prepaid.balance_observed !== false
}

type PlanTerms = {
  key: string
  kind: PlanKind
  funding_policy?: FundingPolicy
  topoff?: PlanTopoff
}

// The team's frozen terms decide; a backend that doesn't report them falls
// back to the current catalog offer for the same plan.
export function planFundingPolicy(
  plan: PlanTerms,
  offers: readonly BillingOffer[] | undefined,
): FundingPolicy {
  if (plan.kind === "prepaid") return "prepaid"
  return (
    plan.funding_policy ??
    findOffer(offers, plan.key)?.funding_policy ??
    "postpaid"
  )
}

export function planTopoff(
  plan: PlanTerms,
  offers: readonly BillingOffer[] | undefined,
): PlanTopoff {
  return plan.topoff !== undefined
    ? plan.topoff
    : (findOffer(offers, plan.key)?.topoff ?? null)
}

// Plans that run on funded credit: prepaid credit, or a subscription that
// spends included and topped-up credit before pausing.
export function fundedByCredit(
  plan: PlanTerms,
  offers: readonly BillingOffer[] | undefined,
): boolean {
  return (
    (plan.kind === "prepaid" || plan.kind === "subscription") &&
    planFundingPolicy(plan, offers) === "prepaid"
  )
}

export const UPGRADE_PATH = "/plan-usage/upgrade"
export const BUY_CREDIT_PATH = "/plan-usage/buy-credit"
export const TOPOFF_SETTINGS_PATH = "/settings/#auto-topoff"
export const PRO_UPGRADE_PATH = "/billing/pro"

// Plan families a team on a plan can buy from the in-app upgrade page.
export const UPGRADE_FAMILIES = ["pro", "developer"] as const
export type UpgradeFamily = (typeof UPGRADE_FAMILIES)[number]

export function upgradeFamily(value: string | null | undefined): UpgradeFamily {
  return value === "developer" ? "developer" : "pro"
}

export function upgradePath(family: string): string | null {
  if (family === "pro") return PRO_UPGRADE_PATH
  return (UPGRADE_FAMILIES as readonly string[]).includes(family)
    ? `${PRO_UPGRADE_PATH}/?plan=${family}`
    : null
}
export const ENTERPRISE_MEETING_URL =
  "https://calendly.com/superserve-ai/25-min"

export function formatCents(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: amount % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount / 100)
}

export const BILLING_V2_PATHS = {
  plan: "/billing/plan",
  "free-allowance": "/billing/free-allowance",
  prepaid: "/billing/prepaid",
} as const

export const catalogPlanSchema = planCardSchema.transform((card) => ({
  key: card.monthly?.offer_key ?? card.family,
  family: card.family,
  kind: card.kind,
  name: card.name,
  price_label: card.price_label,
  fee_cents: card.monthly?.price_cents ?? null,
  included_cents:
    card.allowance?.period === "month"
      ? card.allowance.amount_cents
      : card.monthly_credit_cents,
  limits: card.limits,
  funding_policy:
    card.funding_policy ?? (card.kind === "prepaid" ? "prepaid" : "postpaid"),
  available:
    card.kind === "prepaid" ||
    card.kind === "free" ||
    card.display_only ||
    card.monthly?.available === true,
}))

const catalogSchema = z.object({ cards: z.array(catalogPlanSchema) })
export type CatalogPlan = z.infer<typeof catalogPlanSchema>

export function catalogPlansOf(body: unknown): CatalogPlan[] {
  return catalogSchema
    .parse(body)
    .cards.filter((card) => card.kind !== "legacy_payg")
}

export const planChangePreviewSchema = z.object({
  target_plan_key: z.string(),
  target_display_name: z.string(),
  target_kind: planKindSchema,
  timing: z
    .enum(["immediate", "end_of_billing_period", "after_purchase"])
    .optional(),
  effective_at: z.string().optional(),
  pauses_running: z.boolean(),
  limits: planLimitsSchema.extend({
    max_concurrent: z.number().int().nonnegative().nullable(),
    max_templates: z.number().int().nonnegative().nullable(),
  }),
  blocked: z.string().optional(),
  preview_token: z.string().length(64).optional(),
})

export const planChangeSchema = planChangePreviewSchema
  .omit({ timing: true, blocked: true, preview_token: true })
  .extend({
    id: z.string().uuid(),
    effective_at: z.string(),
    state: z.enum(["scheduled", "applied", "completed", "undone"]),
    undoable: z.boolean(),
  })

export type PlanChange = z.infer<typeof planChangeSchema>

export type PlanChangePreview = z.infer<typeof planChangePreviewSchema>

export const PLAN_CHANGE_PATHS = {
  preview: "/billing/plan-change-preview",
  schedule: "/billing/plan-changes",
  undo: (id: string) => `/billing/plan-changes/${encodeURIComponent(id)}/undo`,
} as const

const PLAN_RANK: Record<PlanKind, number> = {
  free: 0,
  prepaid: 1,
  legacy_payg: 1,
  subscription: 2,
  custom: 3,
}

export type PlanAction =
  | { type: "current" }
  | { type: "scheduled" }
  | { type: "link"; href: string; label: string }
  | { type: "blocked"; undoable: boolean; effectiveAt: string }
  | { type: "contact" }
  | { type: "unavailable" }

export function planAction(current: TeamPlan, target: CatalogPlan): PlanAction {
  if (target.key === current.key) return { type: "current" }
  if (current.pending_change?.plan_key === target.key)
    return { type: "scheduled" }
  if (target.kind === current.kind)
    return target.kind === "free"
      ? { type: "current" }
      : target.kind === "subscription"
        ? { type: "unavailable" }
        : { type: "contact" }
  if (target.kind === "free") return { type: "unavailable" }
  if (current.kind === "custom") return { type: "contact" }
  if (target.kind === "custom")
    return {
      type: "link",
      href: ENTERPRISE_MEETING_URL,
      label: "Book a meeting",
    }
  if (
    PLAN_RANK[target.kind] > PLAN_RANK[current.kind] ||
    current.kind === "legacy_payg"
  ) {
    const href =
      target.kind === "prepaid" ? BUY_CREDIT_PATH : upgradePath(target.family)
    if (!target.available || !href) return { type: "unavailable" }
    const label = `Get ${target.name}`
    if (current.pending_change)
      return {
        type: "blocked",
        undoable: current.pending_change.undoable,
        effectiveAt: current.pending_change.effective_at,
      }
    return { type: "link", href, label }
  }
  // Moving down to a smaller plan isn't offered here under pricing v2.
  return { type: "unavailable" }
}
