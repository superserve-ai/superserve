import { z } from "zod"

import { money } from "./offer-view"
import { type RenewalView } from "./renewal-view"
import { claimID } from "./staff-schema"

const revision = z.number().int().nonnegative().safe()
export const renewalChoice = z.enum(["annual", "monthly", "free"])
export const renewalTerms = z
  .object({
    offer_key: z.string().min(1),
    offer_version: z.number().int().positive(),
    rate_card_key: z.string().min(1),
    currency: z.literal("usd"),
    charge_amount_cents: revision,
    charge_interval_months: z.union([z.literal(1), z.literal(12)]),
    monthly_allowance_cents: z.array(revision),
    payment_requirement: z.literal("verified_payment"),
    rollover: z.literal(false),
    proration: z.literal(false),
  })
  .nullable()
const instruction = z.object({
  request_id: claimID,
  choice: renewalChoice,
  state: z.enum([
    "prepared",
    "dispatched",
    "outcome_unknown",
    "confirmed",
    "rejected",
    "review_required",
  ]),
  terms: renewalTerms,
})
export const renewalSchema = z
  .object({
    assignment_id: claimID,
    acceptance_id: claimID,
    approval_revision: revision,
    choice_revision: revision,
    intended_boundary: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
      .datetime(),
    requested: instruction.nullable(),
    last_confirmed: instruction
      .extend({ state: z.literal("confirmed") })
      .nullable(),
    successor_state: z.enum([
      "scheduled",
      "payment_pending",
      "active",
      "free",
      "review_required",
    ]),
    available_options: z
      .array(
        z.object({
          choice: renewalChoice,
          available: z.boolean(),
          unavailable_reason: z
            .enum([
              "integration_unavailable",
              "boundary_passed",
              "change_pending",
              "catalog_unavailable",
            ])
            .optional(),
          terms: renewalTerms,
        }),
      )
      .max(3),
  })
  .superRefine((value, ctx) => {
    const candidates = [
      value.requested,
      value.last_confirmed,
      ...value.available_options.filter((option) => option.available),
    ].filter((entry) => entry !== null)
    for (const candidate of candidates) {
      if (
        candidate.choice === "free"
          ? candidate.terms !== null
          : !candidate.terms ||
            candidate.terms.charge_interval_months !==
              (candidate.choice === "annual" ? 12 : 1) ||
            candidate.terms.monthly_allowance_cents.length !==
              (candidate.choice === "annual" ? 12 : 1)
      )
        ctx.addIssue({ code: "custom", message: "Incomplete renewal terms" })
    }
    if (
      new Set(value.available_options.map((option) => option.choice)).size !==
      value.available_options.length
    )
      ctx.addIssue({ code: "custom", message: "Duplicate renewal options" })
  })
export type Renewal = z.infer<typeof renewalSchema>
export const renewalInputSchema = z
  .object({
    claim_id: claimID,
    assignment_id: claimID,
    acceptance_id: claimID,
    expected_approval_revision: revision,
    expected_choice_revision: revision,
    request_id: claimID,
    intended_boundary: z.string().datetime(),
    choice: renewalChoice,
  })
  .strict()
export type RenewalInput = z.infer<typeof renewalInputSchema>
export function renewalTermsText(terms: z.infer<typeof renewalTerms>): string {
  if (!terms)
    return "Free plan. Existing usage charges and unpaid balances remain due."
  return `${money(terms.charge_amount_cents, terms.currency)} every ${terms.charge_interval_months} month${terms.charge_interval_months === 1 ? "" : "s"}, plus metered usage. Monthly credits: ${terms.monthly_allowance_cents.map((amount) => money(amount, terms.currency)).join(", ")}. Credits expire monthly without rollover. No proration. Paid access requires verified payment and account eligibility.`
}
export function renewalView(value: Renewal): RenewalView {
  const boundary =
    new Date(value.intended_boundary).toLocaleString("en-US", {
      dateStyle: "long",
      timeStyle: "short",
      timeZone: "UTC",
    }) + " UTC"
  return {
    confirmed: value.last_confirmed && {
      choice: value.last_confirmed.choice,
      terms: renewalTermsText(value.last_confirmed.terms),
      boundary,
    },
    requested: value.requested && {
      choice: value.requested.choice,
      terms: renewalTermsText(value.requested.terms),
      boundary,
      state: value.requested.state,
    },
    options: value.available_options.map((option) => ({
      choice: option.choice,
      terms: option.available
        ? renewalTermsText(option.terms)
        : "Not available",
      boundary,
      available: option.available,
      unavailableReason: option.unavailable_reason,
    })),
    successor:
      value.successor_state === "scheduled" ? "none" : value.successor_state,
  }
}
