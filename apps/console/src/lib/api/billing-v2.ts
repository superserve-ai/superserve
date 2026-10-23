import { z } from "zod"

const cents = z.number().int().nonnegative()

export const planKindSchema = z.enum([
  "free",
  "prepaid",
  "subscription",
  "legacy_payg",
  "custom",
])

export const planLimitsSchema = z.object({
  max_concurrent: z.number().int().nonnegative(),
  max_vcpu: z.number().int().positive().nullable(),
  max_memory_mib: z.number().int().positive().nullable(),
  max_disk_mib: z.number().int().positive().nullable(),
  max_templates: z.number().int().nonnegative().nullable(),
})

export const teamPlanSchema = z.object({
  key: z.string(),
  kind: planKindSchema,
  name: z.string(),
  limits: planLimitsSchema,
  fee_cents: cents.nullable(),
  included_cents: cents.nullable(),
  period_start: z.string().nullable(),
  period_end: z.string().nullable(),
  pending_change: z
    .object({
      plan_key: z.string(),
      plan_name: z.string(),
      effective_at: z.string(),
      undoable: z.boolean(),
    })
    .nullable(),
})

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
export type TeamPlan = z.infer<typeof teamPlanSchema>
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
  starter: "/plan-usage/starter",
  pro: "/plan-usage/pro",
  enterprise: "/plan-usage/enterprise",
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
