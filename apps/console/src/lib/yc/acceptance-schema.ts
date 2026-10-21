import { z } from "zod"

import { financialAuthoritySchema } from "./financial-authority"
import type { JourneyState } from "./journey-state"
import { money, type OfferTermsView } from "./offer-view"
import { claimID } from "./staff-schema"

const cents = z.number().int().nonnegative().safe()
const digest = z.string().regex(/^[a-f0-9]{64}$/)
export const acceptanceTermsSchema = z
  .object({
    offer_key: z.string().min(1),
    offer_version: z.number().int().positive(),
    currency: z.literal("usd"),
    term_months: z.number().int().min(1).max(24),
    charge_amount_cents: cents,
    charge_interval_months: z.union([z.literal(1), z.literal(12)]),
    initial_fee_waived: z.boolean(),
    monthly_allowance_cents: z.array(cents),
    rollover: z.literal(false),
    proration: z.literal(false),
    payment_requirement: z.enum([
      "eligible_credit_or_verified_payment",
      "verified_payment",
    ]),
    rate_card_key: z.string().min(1),
    resource_rates: z
      .array(
        z.object({
          id: claimID,
          resource: z.string().min(1),
          unit: z.string().min(1),
          price_usd: z.string().regex(/^\d+(?:\.\d+)?$/),
          currency: z.literal("USD"),
        }),
      )
      .min(3),
    default_successor_family: z.enum(["pro_annual", "pro_monthly"]),
  })
  .refine((terms) => terms.monthly_allowance_cents.length === terms.term_months)

export const acceptanceSchema = z
  .object({
    acceptance_id: claimID,
    claim_id: claimID,
    user_id: claimID,
    team_id: claimID,
    home_region: z.string().min(1),
    approval_id: claimID,
    approval_revision: cents,
    offer_key: z.string().min(1),
    offer_version: z.number().int().positive(),
    terms_digest: digest,
    renewal_terms_digest: digest,
    terms: acceptanceTermsSchema,
    renewal_terms: acceptanceTermsSchema,
    request_id: claimID.nullable(),
    accepted_at: z.string().datetime({ offset: true }).nullable(),
    assignment_id: claimID.nullable(),
    operation_id: claimID.nullable(),
    ready: z.boolean(),
    financial_authority: financialAuthoritySchema.optional(),
    state: z.enum([
      "offered",
      "confirming",
      "accepted",
      "assignment_linked",
      "provisioning",
      "outcome_unknown",
      "review_required",
      "held",
      "revoked",
      "unavailable",
      "grant_pending",
      "funding_pending",
      "funding_ready",
      "exhausted",
      "payment_needed",
    ]),
    held: z.boolean().optional(),
    revoked: z.boolean().optional(),
    control_pending: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.terms.offer_key === value.offer_key &&
      value.terms.offer_version === value.offer_version,
  )
export type Acceptance = z.infer<typeof acceptanceSchema>
export const acceptInputSchema = z
  .object({
    claim_id: claimID,
    acceptance_id: claimID,
    request_id: claimID,
    approval_revision: cents,
    terms_digest: digest,
    renewal_terms_digest: digest,
  })
  .strict()
export type AcceptInput = z.infer<typeof acceptInputSchema>

export function acceptanceState(value: Acceptance): JourneyState {
  if (value.financial_authority?.state === "revocation_pending")
    return "financial_revocation_pending"
  if (value.financial_authority?.state === "revoked") return "financial_revoked"
  if (value.revoked) return "revoked"
  if (value.held) return "held"
  if (value.control_pending) return "outcome_unknown"
  if (value.state === "funding_ready")
    return value.financial_authority?.state === "valid" &&
      value.ready &&
      value.accepted_at &&
      value.assignment_id &&
      value.operation_id
      ? "funding_ready"
      : "unavailable"
  if (value.state === "offered") return "acceptance_required"
  if (value.state === "confirming") return "outcome_unknown"
  if (value.state === "assignment_linked") return "provisioning"
  return value.state
}

export function offerTermsView(value: Acceptance): OfferTermsView {
  const terms = value.terms
  const renewal = value.renewal_terms
  const allowances: OfferTermsView["allowances"] = []
  terms.monthly_allowance_cents.forEach((amount, index) => {
    const last = allowances.at(-1)
    if (last?.monthlyCents === amount) last.lastMonth = index + 1
    else
      allowances.push({
        firstMonth: index + 1,
        lastMonth: index + 1,
        monthlyCents: amount,
      })
  })
  return {
    title: "Your approved YC offer",
    currency: terms.currency,
    annualFeeCents: terms.charge_amount_cents,
    firstFeeWaived: terms.initial_fee_waived,
    termMonths: terms.term_months,
    allowances,
    expiration:
      "Each monthly allowance expires at the end of that offer month, with no rollover. Your offer starts when activation is confirmed; acceptance does not start the clock.",
    overage:
      terms.payment_requirement === "eligible_credit_or_verified_payment"
        ? "No card is required while eligible sponsored credits remain. Usage beyond available credits requires payment under your account’s billing terms. Existing unpaid charges still apply."
        : "Verified payment is required under your account’s billing terms. Existing unpaid charges still apply.",
    renewal: `Your default next plan is ${renewal.default_successor_family === "pro_annual" ? "Pro Annual" : "Pro Monthly"} at ${money(renewal.charge_amount_cents, renewal.currency)} every ${renewal.charge_interval_months} month${renewal.charge_interval_months === 1 ? "" : "s"}, plus metered usage. Paid benefits require verified payment and account eligibility. You may request Annual, Monthly, or Free; a change takes effect only when confirmed. The last confirmed instruction may renew while a request is pending. Changes do not prorate your current term.`,
    rates: terms.resource_rates.map((rate) => ({
      resource: rate.resource,
      price: `${rate.price_usd} ${rate.currency} per ${rate.unit}`,
    })),
  }
}
