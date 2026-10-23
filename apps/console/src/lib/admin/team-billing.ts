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

const limitSchema = z.number().nullable()

const planLimitsSchema = z.object({
  max_concurrent: limitSchema,
  max_vcpu: limitSchema,
  max_memory_mib: limitSchema,
  max_disk_mib: limitSchema,
  max_templates: limitSchema,
})

export type PlanLimits = z.infer<typeof planLimitsSchema>

const teamPlanSchema = z.object({
  id: z.string(),
  plan_key: z.string(),
  kind: z.string(),
  terms: z.object({ display_name: z.string().optional() }),
  limits: planLimitsSchema,
  effective_from: z.string(),
  effective_to: z.string().nullable(),
  source: z.string(),
  reason: z.string(),
})

const pendingPlanChangeSchema = z.object({
  id: z.string(),
  target_plan_key: z.string(),
  target_display_name: z.string(),
  effective_at: z.string(),
  undoable: z.boolean(),
  pauses_running: z.boolean(),
})

export const teamPlanAssignmentsSchema = z.object({
  current: teamPlanSchema.nullable(),
  history: z.array(teamPlanSchema),
  pending_change: pendingPlanChangeSchema.nullable().optional(),
})

export type TeamPlan = z.infer<typeof teamPlanSchema>
export type TeamPlanAssignments = z.infer<typeof teamPlanAssignmentsSchema>

export function getTeamPlanAssignments(region: string, teamId: string) {
  return adminBillingRequest({
    region,
    path: `/internal/teams/${teamId}/billing/plan-assignments`,
    schema: teamPlanAssignmentsSchema,
  })
}

export const billingCatalogSchema = z.object({
  pricing_version: z.string().optional(),
  plans: z.array(
    z.object({
      id: z.string(),
      pricing_version: z.string().optional(),
      family: z.string(),
      version: z.number(),
      state: z.string(),
      kind: z.string().optional(),
      display_name: z.string(),
      display_only: z.boolean().optional(),
      monthly_fee_cents: z.number().nullable().optional(),
      annual_fee_cents: z.number().nullable().optional(),
      limits: planLimitsSchema.partial(),
    }),
  ),
})

export type CatalogPlan = z.infer<typeof billingCatalogSchema>["plans"][number]

function isAssignablePlan(plan: CatalogPlan): boolean {
  return (
    plan.kind === "custom" &&
    !plan.display_only &&
    !plan.monthly_fee_cents &&
    !plan.annual_fee_cents &&
    plan.limits.max_concurrent != null
  )
}

export interface PlanCatalog {
  pricingV2: boolean
  assignablePlans: CatalogPlan[]
  freeLimits: Partial<PlanLimits> | null
}

export async function getPlanCatalog(region: string): Promise<PlanCatalog> {
  const catalog = await adminBillingRequest({
    region,
    path: "/internal/billing/catalog",
    schema: billingCatalogSchema,
  })
  const plans = catalog.plans.filter(
    (p) => p.state === "published" && p.pricing_version === "v2",
  )
  return {
    pricingV2: catalog.pricing_version === "v2",
    assignablePlans: plans.filter(isAssignablePlan),
    freeLimits: plans.find((p) => p.family === "free")?.limits ?? null,
  }
}

export interface AssignTeamPlanInput {
  idempotencyKey: string
  versionId: string
  reason: string
}

export function assignTeamPlan(
  region: string,
  teamId: string,
  input: AssignTeamPlanInput,
) {
  return adminBillingRequest({
    region,
    method: "POST",
    path: `/internal/teams/${teamId}/billing/plan-assignments`,
    body: {
      idempotency_key: input.idempotencyKey,
      version_id: input.versionId,
      reason: input.reason,
    },
    schema: teamPlanSchema,
  })
}

export const PLAN_CHANGE_TARGETS = ["free", "starter", "pro_monthly"] as const

export type PlanChangeTarget = (typeof PLAN_CHANGE_TARGETS)[number]

const planChangeSchema = z.object({
  id: z.string(),
  target_plan_key: z.string(),
  effective_at: z.string(),
  pauses_running: z.boolean(),
})

export interface RequestPlanChangeInput {
  idempotencyKey: string
  targetPlan: PlanChangeTarget
  reason: string
}

export function requestPlanChange(
  region: string,
  teamId: string,
  input: RequestPlanChangeInput,
) {
  return adminBillingRequest({
    region,
    method: "POST",
    path: `/internal/teams/${teamId}/billing/plan-changes`,
    body: {
      idempotency_key: input.idempotencyKey,
      target_plan: input.targetPlan,
      reason: input.reason,
    },
    schema: planChangeSchema,
  })
}

export function undoPlanChange(
  region: string,
  teamId: string,
  changeId: string,
  reason: string,
) {
  return adminBillingRequest({
    region,
    method: "POST",
    path: `/internal/teams/${teamId}/billing/plan-changes/${changeId}/undo`,
    body: { reason },
    schema: planChangeSchema,
  })
}

const staffCreditSchema = z.object({
  id: z.string(),
  idempotency_key: z.string(),
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
