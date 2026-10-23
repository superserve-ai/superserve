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

export const planComputeSchema = z.object({
  seconds: z.number().int().positive(),
  vcpu: z.number().int().positive(),
  memory_gib: z.number().int().positive(),
})

export const planAllowanceSchema = z
  .object({
    amount_cents: z.number().int().nonnegative(),
    amount_usd: z.string().optional(),
    period: z.enum(["day_window", "month"]),
    on_exhausted: z.enum(["pause", "payg"]),
    compute: planComputeSchema.optional(),
  })
  .nullable()

export const planLimitsSchema = z.object({
  max_concurrent: z.number().int().positive().nullable(),
  max_vcpu: z.number().int().positive().nullable(),
  max_memory_mib: z.number().int().positive().nullable(),
  max_disk_mib: z.number().int().positive().nullable(),
  max_templates: z.number().int().positive().nullable(),
})

export const pricingVersionSchema = z.enum(["legacy", "v2"])

export const planKindSchema = z.enum([
  "free",
  "prepaid",
  "subscription",
  "legacy_payg",
  "custom",
])

export const planCardSchema = z.object({
  family: z.string(),
  version: z.number().int(),
  kind: planKindSchema,
  name: z.string(),
  price_label: z.string(),
  tagline: z.string(),
  features: z.array(z.string()),
  display_only: z.boolean(),
  monthly: price,
  annual: price,
  credit_summary: z.string(),
  monthly_credit_cents: z.number().int().positive().nullable(),
  allowance: planAllowanceSchema
    .unwrap()
    .extend({ summary: z.string() })
    .nullable(),
  matching: planMatchingSchema,
  limits: planLimitsSchema,
})

export const publicBillingPlansSchema = z.object({
  pricing_version: pricingVersionSchema,
  cards: z.array(planCardSchema),
})

export type PlanGrant = z.infer<typeof planGrantSchema>
export type PlanMatching = z.infer<typeof planMatchingSchema>
export type PlanAllowance = z.infer<typeof planAllowanceSchema>
export type PlanLimits = z.infer<typeof planLimitsSchema>
export type PlanKind = z.infer<typeof planKindSchema>
export type PricingVersion = z.infer<typeof pricingVersionSchema>
export type PlanCard = z.infer<typeof planCardSchema>
export type PublicBillingPlans = z.infer<typeof publicBillingPlansSchema>

export function formatUsdCents(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100)
}
