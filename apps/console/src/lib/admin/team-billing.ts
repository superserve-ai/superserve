import "server-only"
import { z } from "zod"

import { adminBillingRequest } from "@/lib/admin/billing-api"
import { configuredRegions } from "@/lib/cells"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function isUuid(value: string): boolean {
  return UUID.test(value)
}

const billingTeamsSchema = z.object({
  pagination: z.object({ total: z.number() }),
  rows: z.array(
    z.object({
      team_id: z.string(),
      team_name: z.string(),
      summary: z
        .object({
          current_charges_usd: z.number(),
          credits_remaining_usd: z.number(),
        })
        .nullable(),
    }),
  ),
})

export interface BillingTeamRow {
  teamId: string
  teamName: string
  region: string
  currentChargesUsd: number | null
  creditsRemainingUsd: number | null
}

export const BILLING_TEAMS_PAGE = 50

export async function listBillingTeams(search: string): Promise<{
  teams: BillingTeamRow[]
  unavailableRegions: string[]
  hiddenTeams: number
  allRegionsUnavailable: boolean
}> {
  const regions = configuredRegions()
  const query = new URLSearchParams({
    limit: String(BILLING_TEAMS_PAGE),
    sort: "team_name",
    order: "asc",
  })
  if (search) query.set("search", search)
  const settled = await Promise.allSettled(
    regions.map((region) =>
      adminBillingRequest({
        region,
        path: "/internal/billing",
        query,
        schema: billingTeamsSchema,
      }),
    ),
  )
  const teams: BillingTeamRow[] = []
  const unavailableRegions: string[] = []
  let hiddenTeams = 0
  settled.forEach((result, i) => {
    if (result.status === "rejected") {
      unavailableRegions.push(regions[i])
      return
    }
    hiddenTeams += Math.max(
      0,
      result.value.pagination.total - result.value.rows.length,
    )
    for (const row of result.value.rows) {
      teams.push({
        teamId: row.team_id,
        teamName: row.team_name,
        region: regions[i],
        currentChargesUsd: row.summary?.current_charges_usd ?? null,
        creditsRemainingUsd: row.summary?.credits_remaining_usd ?? null,
      })
    }
  })
  teams.sort((a, b) => a.teamName.localeCompare(b.teamName))
  return {
    teams,
    unavailableRegions,
    hiddenTeams,
    allRegionsUnavailable: unavailableRegions.length === regions.length,
  }
}

const planTermsSchema = z.object({
  offer_key: z.string(),
  fee_cents: z.number(),
  interval_months: z.number(),
  monthly_credit_cents: z.number(),
})

const planChangeSchema = z.object({
  id: z.string(),
  target_offer: z.string(),
  terms: planTermsSchema.partial(),
  effective_at: z.string(),
  state: z.enum([
    "scheduled",
    "prepared",
    "switched",
    "completed",
    "canceled",
    "failed",
  ]),
  requested_by: z.string(),
  requested_at: z.string(),
  reason: z.string(),
  deferrals: z.number(),
  cancelable: z.boolean(),
  canceled_at: z.string().nullable(),
  cancel_reason: z.string().nullable(),
  last_error: z.string().nullable(),
})

const contractSchema = z.object({
  id: z.string(),
  offer_key: z.string(),
  status: z.string(),
  starts_at: z.string(),
  ends_at: z.string().nullable(),
  charge_kind: z.string(),
  charge_amount_cents: z.number(),
  charge_interval_months: z.number(),
  entitlement_amount_cents: z.number(),
  entitlement_cadence: z.string(),
})

export const teamPlanBillingSchema = z.object({
  team_id: z.string(),
  customer_id: z.string().nullable(),
  subscription_id: z.string().nullable(),
  subscription_status: z.string().nullable(),
  billing_anchor: z.string().nullable(),
  period_start: z.string().nullable(),
  period_end: z.string().nullable(),
  contract: contractSchema.nullable(),
  pending_change: planChangeSchema.nullable(),
  changes: z.array(planChangeSchema),
  credits: z.array(
    z.object({
      period_start: z.string(),
      period_end: z.string(),
      amount_cents: z.number(),
      state: z.string(),
      grant_id: z.string().nullable(),
      remaining_cents: z.number().nullable(),
    }),
  ),
  card: z
    .object({
      brand: z.string(),
      last4: z.string(),
      exp_month: z.number(),
      exp_year: z.number(),
    })
    .nullable(),
  invoices: z.array(
    z.object({
      id: z.string(),
      number: z.string(),
      status: z.string(),
      total_cents: z.number(),
      amount_paid_cents: z.number(),
      created: z.number(),
      period_start: z.number(),
      period_end: z.number(),
      hosted_invoice_url: z.string(),
    }),
  ),
  plan_options: z.array(
    planTermsSchema.extend({ name: z.string(), available: z.boolean() }),
  ),
  provider_error: z.string().optional(),
})

export type TeamPlanBilling = z.infer<typeof teamPlanBillingSchema>
export type PlanChange = z.infer<typeof planChangeSchema>

export function getTeamPlanBilling(region: string, teamId: string) {
  return adminBillingRequest({
    region,
    path: `/internal/teams/${teamId}/billing/plan`,
    schema: teamPlanBillingSchema,
  })
}

export interface SchedulePlanChangeInput {
  idempotencyKey: string
  targetOffer: string
  reason: string
}

export function schedulePlanChange(
  region: string,
  teamId: string,
  input: SchedulePlanChangeInput,
) {
  return adminBillingRequest({
    region,
    method: "POST",
    path: `/internal/teams/${teamId}/billing/plan-changes`,
    body: {
      idempotency_key: input.idempotencyKey,
      target_offer: input.targetOffer,
      reason: input.reason,
    },
    schema: planChangeSchema,
  })
}

export function cancelPlanChange(
  region: string,
  teamId: string,
  changeId: string,
  reason: string,
) {
  return adminBillingRequest({
    region,
    method: "POST",
    path: `/internal/teams/${teamId}/billing/plan-changes/${changeId}/cancel`,
    body: { reason },
    schema: planChangeSchema,
  })
}

const staffCreditSchema = z.object({
  id: z.string(),
  amount_cents: z.number(),
  reason: z.string(),
  requested_by: z.string(),
  requested_at: z.string(),
  state: z.enum(["pending", "issued"]),
  stripe_credit_grant_id: z.string().nullable(),
  issued_at: z.string().nullable(),
  last_error: z.string().nullable(),
})

export type StaffCredit = z.infer<typeof staffCreditSchema>

export async function listStaffCredits(region: string, teamId: string) {
  const result = await adminBillingRequest({
    region,
    path: `/internal/teams/${teamId}/billing/credit-grants`,
    schema: z.object({ credits: z.array(staffCreditSchema) }),
  })
  return result.credits
}

export interface GrantStaffCreditInput {
  idempotencyKey: string
  amountCents: number
  reason: string
}

export function grantStaffCredit(
  region: string,
  teamId: string,
  input: GrantStaffCreditInput,
) {
  return adminBillingRequest({
    region,
    method: "POST",
    path: `/internal/teams/${teamId}/billing/credit-grants`,
    body: {
      idempotency_key: input.idempotencyKey,
      amount_cents: input.amountCents,
      reason: input.reason,
    },
    schema: staffCreditSchema,
  })
}
