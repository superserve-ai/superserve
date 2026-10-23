import { z } from "zod"

import {
  planCardSchema,
  planKindSchema,
  planLimitsSchema,
} from "@/lib/billing/plans"

export { planKindSchema, planLimitsSchema } from "@/lib/billing/plans"

const cents = z.number().int().nonnegative()

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
      })
      .nullable(),
    period: z.object({ start: z.string(), end: z.string() }),
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
  .transform(({ plan, period, pending_change }) =>
    plan === null
      ? null
      : {
          key: plan.plan_key,
          kind: plan.kind,
          name: plan.display_name,
          limits: plan.limits,
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

export const LOW_BALANCE_CENTS = 500

export function isLowBalance(prepaid: PrepaidBalance): boolean {
  return (
    prepaid.balance_cents <= 0 ||
    (prepaid.balance_cents <= LOW_BALANCE_CENTS &&
      !prepaid.auto_recharge.enabled)
  )
}

export const UPGRADE_PATH = "/plan-usage/upgrade"

export const PLAN_ACTION_LINKS = {
  starter: "/plan-usage/buy-credit",
  pro: "/billing/pro",
  enterprise: "https://calendly.com/superserve-ai/25-min",
} as const

export function formatCents(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: amount % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount / 100)
}

export function describeSandboxSize(limits: PlanLimits): string | null {
  const parts = [
    limits.max_vcpu !== null && `${limits.max_vcpu} vCPU`,
    limits.max_memory_mib !== null &&
      `${formatMiB(limits.max_memory_mib)} memory`,
    limits.max_disk_mib !== null && `${formatMiB(limits.max_disk_mib)} disk`,
  ].filter((part): part is string => typeof part === "string")
  return parts.length ? parts.join(", ") : null
}

function formatMiB(mib: number): string {
  return mib % 1024 === 0 ? `${mib / 1024} GiB` : `${mib} MiB`
}

export const BILLING_V2_PATHS = {
  plan: "/billing/plan",
  "free-allowance": "/billing/free-allowance",
  prepaid: "/billing/prepaid",
} as const

export const catalogPlanSchema = planCardSchema.transform((card) => ({
  key: card.monthly?.offer_key ?? card.family,
  kind: card.kind,
  name: card.name,
  price_label: card.price_label,
  fee_cents: card.monthly?.price_cents ?? null,
  included_cents:
    card.allowance?.period === "month"
      ? card.allowance.amount_cents
      : card.monthly_credit_cents,
  limits: card.limits,
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
  | { type: "downgrade"; label: string }
  | { type: "blocked"; undoable: boolean; effectiveAt: string }
  | { type: "contact" }
  | { type: "unavailable" }

export function planAction(current: TeamPlan, target: CatalogPlan): PlanAction {
  if (target.key === current.key) return { type: "current" }
  if (current.pending_change?.plan_key === target.key)
    return { type: "scheduled" }
  if (target.kind === current.kind)
    return target.kind === "free" ? { type: "current" } : { type: "contact" }
  if (target.kind === "free")
    return { type: "downgrade", label: "Switch to Free" }
  if (current.kind === "custom") return { type: "contact" }
  if (target.kind === "custom")
    return {
      type: "link",
      href: PLAN_ACTION_LINKS.enterprise,
      label: "Book a meeting",
    }
  if (
    PLAN_RANK[target.kind] > PLAN_RANK[current.kind] ||
    current.kind === "legacy_payg"
  ) {
    if (!target.available) return { type: "unavailable" }
    const label = `Get ${target.name}`
    if (current.pending_change)
      return {
        type: "blocked",
        undoable: current.pending_change.undoable,
        effectiveAt: current.pending_change.effective_at,
      }
    return {
      type: "link",
      href:
        target.kind === "prepaid"
          ? PLAN_ACTION_LINKS.starter
          : PLAN_ACTION_LINKS.pro,
      label,
    }
  }
  return { type: "downgrade", label: `Switch to ${target.name}` }
}
