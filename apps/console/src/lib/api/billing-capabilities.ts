import { z } from "zod"

import {
  billingOffersSchema,
  findOffer,
  type PlanKind,
  publicBillingPlansSchema,
} from "@/lib/billing/plans"

import { apiClient } from "./client"

export const billingCapabilitiesSchema = z
  .object({
    schema_version: z.literal(1),
    team_id: z.string().uuid(),
    pricing_version: z.enum(["legacy", "v2"]),
    admission_source: z.enum(["legacy", "all_teams", "new_team"]),
    entry_open: z.boolean(),
    epoch: z.string().uuid().nullable(),
    enrollment_epoch: z.string().uuid().nullable(),
    fresh_entry: z.object({
      starter: z.boolean(),
      pro: z.boolean(),
      auto_recharge: z.boolean(),
      choose_free: z.boolean(),
    }),
    actions: z.object({
      recover_payment: z.boolean(),
      disable_auto_recharge: z.boolean(),
    }),
    catalog: publicBillingPlansSchema,
    offers: billingOffersSchema,
  })
  .superRefine((value, ctx) => {
    if (value.catalog.pricing_version !== value.pricing_version)
      ctx.addIssue({
        code: "custom",
        message: "Billing catalog model mismatch",
      })
    if (
      (value.pricing_version !== "v2" || !value.entry_open) &&
      Object.values(value.fresh_entry).some(Boolean)
    )
      ctx.addIssue({
        code: "custom",
        message: "Invalid fresh billing admission",
      })
  })

export type BillingCapabilities = z.infer<typeof billingCapabilitiesSchema>

function freshEntryFor(
  capabilities: BillingCapabilities,
  kind: PlanKind,
): boolean {
  switch (kind) {
    case "prepaid":
      return capabilities.fresh_entry.starter
    case "subscription":
      return capabilities.fresh_entry.pro
    default:
      return false
  }
}

// Whether this team can buy plan now: the entry gate for its kind must be
// open, and a catalog offer for it, where listed, must be sellable.
export function canStartPlan(
  capabilities: BillingCapabilities | undefined,
  plan: { key: string; kind: PlanKind },
): boolean {
  if (!capabilities || !freshEntryFor(capabilities, plan.kind)) return false
  return findOffer(capabilities.offers, plan.key)?.sellable ?? true
}

export function canStartAnyPlan(
  capabilities: BillingCapabilities | undefined,
): boolean {
  if (!capabilities) return false
  const offers = capabilities.offers ?? []
  return (
    (capabilities.fresh_entry.pro || capabilities.fresh_entry.starter) &&
    (offers.length === 0 || offers.some((offer) => offer.sellable))
  )
}

export function parseBillingCapabilities(body: unknown, teamKey: string) {
  const parsed = billingCapabilitiesSchema.parse(body)
  if (parsed.team_id !== teamKey.slice(teamKey.indexOf(":") + 1))
    throw new Error("Billing capabilities belong to another team")
  return parsed
}

export async function getBillingCapabilities(teamKey: string) {
  return parseBillingCapabilities(
    await apiClient<unknown>("/billing/capabilities", { cache: "no-store" }),
    teamKey,
  )
}
