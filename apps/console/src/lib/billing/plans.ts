import { z } from "zod"

const price = z
  .object({
    offer_key: z.string(),
    price_cents: z.number().int().positive(),
    monthly_equivalent_cents: z.number().int().nonnegative(),
    available: z.boolean(),
  })
  .nullable()

export const planGrantSchema = z.object({
  start_months: z.number().int().min(0),
  repeat: z.number().int().positive().nullable(),
  every_months: z.number().int().positive(),
  amount_cents: z.number().int().positive(),
  expires_after_months: z.number().int().positive(),
})

export const planMatchingSchema = z
  .object({
    matching_bps: z.number().int().min(1).max(10000),
    cap_cents: z.number().int().positive(),
  })
  .nullable()

export const planLimitsSchema = z.object({
  max_sandboxes: z.number().int().positive().nullable(),
  max_template_vcpu: z.number().int().positive().nullable(),
  max_template_memory_mib: z.number().int().positive().nullable(),
  max_template_disk_mib: z.number().int().positive().nullable(),
})

export const planCardSchema = z.object({
  family: z.string(),
  version: z.number().int(),
  name: z.string(),
  tagline: z.string(),
  features: z.array(z.string()),
  display_only: z.boolean(),
  monthly: price,
  annual: price,
  credit_summary: z.string(),
  monthly_credit_cents: z.number().int().positive().nullable(),
  credit_schedule: z.array(planGrantSchema),
  matching: planMatchingSchema,
  limits: planLimitsSchema,
})

export const publicBillingPlansSchema = z.object({
  cards: z.array(planCardSchema),
  signup: z.object({
    trial_credit_cents: z.number().int().positive(),
    card_bonus_cents: z.number().int().positive(),
  }),
})

export type PlanGrant = z.infer<typeof planGrantSchema>
export type PlanMatching = z.infer<typeof planMatchingSchema>
export type PlanLimits = z.infer<typeof planLimitsSchema>
export type PlanCard = z.infer<typeof planCardSchema>
export type PublicBillingPlans = z.infer<typeof publicBillingPlansSchema>

export function teamRegion(teamKey: string | null | undefined) {
  return teamKey?.split(":")[0] || undefined
}

export function formatUsdCents(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100)
}

export function planCard(
  plans: PublicBillingPlans | null | undefined,
  family: string,
): PlanCard | undefined {
  return plans?.cards.find((card) => card.family === family)
}

function formatGiB(mib: number): string {
  return `${Number.isInteger(mib / 1024) ? mib / 1024 : (mib / 1024).toFixed(1)} GiB`
}

export function planSandboxSize(limits: PlanLimits): string | null {
  const parts = [
    limits.max_template_vcpu ? `${limits.max_template_vcpu} vCPU` : null,
    limits.max_template_memory_mib
      ? `${formatGiB(limits.max_template_memory_mib)} memory`
      : null,
    limits.max_template_disk_mib
      ? `${formatGiB(limits.max_template_disk_mib)} disk`
      : null,
  ].filter(Boolean)
  return parts.length ? `Up to ${parts.join(", ")} per sandbox` : null
}
