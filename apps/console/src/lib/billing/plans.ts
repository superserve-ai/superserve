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
  max_templates: z.number().int().nonnegative().nullable(),
})

export const pricingVersionSchema = z.enum(["legacy", "v2"])

export const planKindSchema = z.enum([
  "free",
  "prepaid",
  "subscription",
  "legacy_payg",
  "custom",
])

export const fundingPolicySchema = z.enum(["prepaid", "postpaid"])

export const planTopoffSchema = z
  .object({
    amount_cents: z.number().int().positive(),
    threshold_cents: z.number().int().positive(),
    default_enabled: z.boolean(),
  })
  .nullable()

export const billingOfferSchema = z.object({
  offer_key: z.string(),
  family: z.string(),
  display_name: z.string(),
  price_cents: z.number().int().nonnegative(),
  interval_months: z.number().int().positive(),
  included_credit_cents: z.number().int().nonnegative().nullable(),
  funding_policy: fundingPolicySchema,
  topoff: planTopoffSchema,
  sellable: z.boolean(),
})

// Offers are optional catalog detail: a backend without them keeps today's
// behaviour, and an entry this console cannot read is left out on its own.
export const billingOffersSchema = z
  .array(z.unknown())
  .catch([])
  .transform((entries) =>
    entries.flatMap((entry) => {
      const offer = billingOfferSchema.safeParse(entry)
      return offer.success ? [offer.data] : []
    }),
  )

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
  funding_policy: fundingPolicySchema.optional().catch(undefined),
  topoff: planTopoffSchema.optional().catch(undefined),
})

export const publicBillingPlansSchema = z.object({
  pricing_version: pricingVersionSchema,
  cards: z.array(planCardSchema),
  signup_admission: z
    .object({
      schema_version: z.literal(1),
      pricing_version: pricingVersionSchema,
      source: z.enum(["legacy", "all_teams", "new_team"]),
      entry_open: z.boolean(),
      epoch: z.string().uuid().nullable(),
    })
    .optional(),
})

export type PlanGrant = z.infer<typeof planGrantSchema>
export type PlanMatching = z.infer<typeof planMatchingSchema>
export type PlanAllowance = z.infer<typeof planAllowanceSchema>
export type PlanLimits = z.infer<typeof planLimitsSchema>
export type PlanKind = z.infer<typeof planKindSchema>
export type PricingVersion = z.infer<typeof pricingVersionSchema>
export type PlanCard = z.infer<typeof planCardSchema>
export type PublicBillingPlans = z.infer<typeof publicBillingPlansSchema>
export type FundingPolicy = z.infer<typeof fundingPolicySchema>
export type PlanTopoff = z.infer<typeof planTopoffSchema>
export type BillingOffer = z.infer<typeof billingOfferSchema>

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

function formatMiB(mib: number): string {
  return mib % 1024 === 0 ? `${mib / 1024} GiB` : `${mib} MiB`
}

// Disk is an internal cap and is never shown.
export function describeSandboxSize(
  limits: Pick<PlanLimits, "max_vcpu" | "max_memory_mib">,
): string | null {
  const parts = [
    limits.max_vcpu ? `${limits.max_vcpu} vCPU` : null,
    limits.max_memory_mib ? `${formatMiB(limits.max_memory_mib)} memory` : null,
  ].filter(Boolean)
  return parts.length ? parts.join(", ") : null
}

export function planSandboxSize(limits: PlanLimits): string | null {
  const size = describeSandboxSize(limits)
  return size ? `Up to ${size} per sandbox` : null
}

export function findOffer(
  offers: readonly BillingOffer[] | undefined,
  offerKey: string | null | undefined,
): BillingOffer | undefined {
  return offerKey
    ? offers?.find((offer) => offer.offer_key === offerKey)
    : undefined
}
