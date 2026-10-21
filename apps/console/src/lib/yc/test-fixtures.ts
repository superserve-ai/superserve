import type { Acceptance } from "./acceptance-schema"
import type { Renewal } from "./renewal-schema"

export const ids = {
  user: "11111111-1111-4111-8111-111111111111",
  claim: "22222222-2222-4222-8222-222222222222",
  team: "33333333-3333-4333-8333-333333333333",
  acceptance: "44444444-4444-4444-8444-444444444444",
  approval: "55555555-5555-4555-8555-555555555555",
  assignment: "66666666-6666-4666-8666-666666666666",
  operation: "77777777-7777-4777-8777-777777777777",
  request: "88888888-8888-4888-8888-888888888888",
}
const terms = {
  offer_key: "yc",
  offer_version: 1,
  currency: "usd" as const,
  term_months: 12,
  charge_amount_cents: 1200000,
  charge_interval_months: 12 as const,
  initial_fee_waived: true,
  monthly_allowance_cents: [
    3000000, 3000000, 3000000, 100000, 100000, 100000, 100000, 100000, 100000,
    100000, 100000, 100000,
  ],
  rollover: false as const,
  proration: false as const,
  payment_requirement: "eligible_credit_or_verified_payment" as const,
  rate_card_key: "approved",
  resource_rates: [
    {
      id: ids.user,
      resource: "CPU",
      unit: "core-hour",
      price_usd: "0.01",
      currency: "USD" as const,
    },
    {
      id: ids.claim,
      resource: "Memory",
      unit: "GiB-hour",
      price_usd: "0.001",
      currency: "USD" as const,
    },
    {
      id: ids.team,
      resource: "Storage",
      unit: "GiB-hour",
      price_usd: "0.0001",
      currency: "USD" as const,
    },
  ],
  default_successor_family: "pro_annual" as const,
}
export function offered(overrides: Partial<Acceptance> = {}): Acceptance {
  return {
    acceptance_id: ids.acceptance,
    claim_id: ids.claim,
    user_id: ids.user,
    team_id: ids.team,
    home_region: "use",
    approval_id: ids.approval,
    approval_revision: 3,
    offer_key: "yc",
    offer_version: 1,
    terms_digest: "a".repeat(64),
    renewal_terms_digest: "b".repeat(64),
    terms,
    renewal_terms: {
      ...terms,
      offer_key: "pro_annual",
      initial_fee_waived: false,
      monthly_allowance_cents: Array(12).fill(100000),
      payment_requirement: "verified_payment",
    },
    request_id: null,
    accepted_at: null,
    assignment_id: null,
    operation_id: null,
    ready: false,
    financial_authority: overrides.accepted_at
      ? { kind: "accepted_offer", state: "valid", pending_invalidations: 0 }
      : {
          kind: "accepted_offer",
          state: "acceptance_pending",
          pending_invalidations: 0,
        },
    state: "offered",
    ...overrides,
  }
}
export function renewal(overrides: Partial<Renewal> = {}): Renewal {
  const annual = {
    offer_key: "pro_annual",
    offer_version: 1,
    rate_card_key: "approved",
    currency: "usd" as const,
    charge_amount_cents: 1200000,
    charge_interval_months: 12 as const,
    monthly_allowance_cents: Array(12).fill(100000),
    payment_requirement: "verified_payment" as const,
    rollover: false as const,
    proration: false as const,
  }
  return {
    assignment_id: ids.assignment,
    acceptance_id: ids.acceptance,
    approval_revision: 3,
    choice_revision: 1,
    intended_boundary: "2027-10-21T15:00:00Z",
    requested: null,
    last_confirmed: {
      request_id: ids.request,
      choice: "annual",
      state: "confirmed",
      terms: annual,
    },
    successor_state: "scheduled",
    available_options: [
      { choice: "annual", available: true, terms: annual },
      {
        choice: "monthly",
        available: false,
        unavailable_reason: "catalog_unavailable",
        terms: null,
      },
      { choice: "free", available: true, terms: null },
    ],
    ...overrides,
  }
}
