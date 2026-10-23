import { z } from "zod"

import {
  planAllowanceSchema,
  planGrantSchema,
  planKindSchema,
  planLimitsSchema,
  planMatchingSchema,
  pricingVersionSchema,
} from "@/lib/billing/plans"

export const planGrantIssueSchema = z.object({
  month_offset: z.number().int(),
  amount_cents: z.number().int(),
  expires_after_months: z.number().int(),
})

export const schedulePreviewSchema = z.object({
  issues: z.array(planGrantIssueSchema),
  summary: z.string(),
  months: z.number().int(),
})

export const planVersionSchema = z.object({
  id: z.string(),
  pricing_version: pricingVersionSchema,
  family: z.string(),
  version: z.number().int(),
  state: z.enum(["draft", "published", "retired"]),
  kind: planKindSchema,
  public: z.boolean(),
  display_name: z.string(),
  price_label: z.string(),
  tagline: z.string(),
  features: z.array(z.string()),
  sort_order: z.number().int(),
  display_only: z.boolean(),
  self_serve: z.boolean(),
  monthly_fee_cents: z.number().int().nullable(),
  annual_fee_cents: z.number().int().nullable(),
  credit_schedule: z.array(planGrantSchema),
  matching: planMatchingSchema,
  allowance: planAllowanceSchema,
  limits: planLimitsSchema,
  created_at: z.string(),
  published_at: z.string().nullable(),
  retired_at: z.string().nullable(),
  preview: schedulePreviewSchema,
})

export const billingCatalogSchema = z.object({
  plans: z.array(planVersionSchema),
  pricing_version: pricingVersionSchema,
})

export type PlanGrantIssue = z.infer<typeof planGrantIssueSchema>
export type SchedulePreview = z.infer<typeof schedulePreviewSchema>
export type PlanVersion = z.infer<typeof planVersionSchema>
export type BillingCatalog = z.infer<typeof billingCatalogSchema>

export interface PlanDraft {
  pricing_version: PlanVersion["pricing_version"]
  family: string
  kind: PlanVersion["kind"]
  public: boolean
  display_name: string
  price_label: string
  tagline: string
  features: string[]
  sort_order: number
  display_only: boolean
  self_serve: boolean
  monthly_fee_cents: number | null
  annual_fee_cents: number | null
  credit_schedule: PlanVersion["credit_schedule"]
  matching: PlanVersion["matching"]
  allowance: PlanVersion["allowance"]
  limits: PlanVersion["limits"]
}

export function draftFromVersion(version: PlanVersion): PlanDraft {
  return {
    pricing_version: version.pricing_version,
    family: version.family,
    kind: version.kind,
    public: version.public,
    display_name: version.display_name,
    price_label: version.price_label,
    tagline: version.tagline,
    features: version.features,
    sort_order: version.sort_order,
    display_only: version.display_only,
    self_serve: version.self_serve,
    monthly_fee_cents: version.monthly_fee_cents,
    annual_fee_cents: version.annual_fee_cents,
    credit_schedule: version.credit_schedule,
    matching: version.matching,
    allowance: version.allowance,
    limits: version.limits,
  }
}

export type RegionState = "draft" | "published" | "retired" | "missing"

export type SyncStep = "create" | "publish" | "retire"

export interface MergedVersion {
  version: PlanVersion
  states: Record<string, RegionState>
  steps: Record<string, SyncStep[]>
}

const RANK = { missing: 0, draft: 1, published: 2, retired: 3 } as const

export interface SyncMember {
  version: number
  states: Record<string, RegionState>
}

type Steps = Record<string, SyncStep[]>

const noSteps = (states: Record<string, RegionState>): Steps =>
  Object.fromEntries(Object.keys(states).map((r) => [r, []]))

const reached = (m: SyncMember, ...wanted: RegionState[]) =>
  Object.values(m.states).some((s) => wanted.includes(s))

// Only the newest version of a family that left draft anywhere is synced, so
// a retry can never publish an older version over a newer one. Published
// somewhere means published everywhere; retired everywhere it reached means
// the family was withdrawn, so every region retires what it still publishes.
// Drafts are never synced: staff save or delete them again, so a
// half-finished delete is not undone.
export function planGroupSync(group: SyncMember[]): Steps[] {
  const steps = group.map((m) => noSteps(m.states))
  const settled = group
    .map((m, i) => [m, i] as const)
    .filter(([m]) => reached(m, "published", "retired"))
    .toSorted(([a], [b]) => b.version - a.version)
  if (!settled.length) return steps
  const [newest, index] =
    settled.find(([member]) => reached(member, "published")) ?? settled[0]!
  if (reached(newest, "published") && !reached(newest, "retired")) {
    steps[index] = Object.fromEntries(
      Object.entries(newest.states).map(([region, state]) => [
        region,
        state === "missing"
          ? ["create", "publish"]
          : state === "draft"
            ? ["publish"]
            : [],
      ]),
    )
    return steps
  }
  steps[index] = Object.fromEntries(
    Object.entries(newest.states).map(([region, state]) => [
      region,
      state === "published" ? ["retire"] : [],
    ]),
  )
  return steps
}

export function needsSync(steps: Steps): boolean {
  return Object.values(steps).some((s) => s.length > 0)
}

export function outOfStep(states: Record<string, RegionState>): boolean {
  return new Set(Object.values(states)).size > 1
}

function applyGroups<
  T extends { states: Record<string, RegionState>; steps: Steps },
>(
  members: T[],
  key: (m: T) => string,
  version: (m: T) => number,
  plan: (group: SyncMember[]) => Steps[],
) {
  const groups = new Map<string, T[]>()
  for (const m of members)
    groups.set(key(m), [...(groups.get(key(m)) ?? []), m])
  for (const group of groups.values()) {
    const steps = plan(
      group.map((m) => ({ version: version(m), states: m.states })),
    )
    group.forEach((m, i) => (m.steps = steps[i]!))
  }
}

// Each pricing model publishes its own version of a family, so versions are
// synced per model and family.
export function planSet(
  version: Pick<PlanVersion, "pricing_version" | "family">,
): string {
  return `${version.pricing_version}:${version.family}`
}

export function mergeCatalogs(catalogs: Record<string, BillingCatalog>) {
  const regions = Object.keys(catalogs)
  const versions = new Map<string, MergedVersion>()
  for (const region of regions) {
    for (const plan of catalogs[region]!.plans) {
      const merged = versions.get(plan.id) ?? {
        version: plan,
        states: Object.fromEntries(regions.map((r) => [r, "missing"])),
        steps: {},
      }
      merged.states[region] = plan.state
      if (RANK[plan.state] > RANK[merged.version.state]) merged.version = plan
      versions.set(plan.id, merged)
    }
  }
  applyGroups(
    [...versions.values()],
    (m) => planSet(m.version),
    (m) => m.version.version,
    planGroupSync,
  )
  return [...versions.values()].toSorted(
    (a, b) =>
      a.version.pricing_version.localeCompare(b.version.pricing_version) ||
      a.version.sort_order - b.version.sort_order ||
      a.version.family.localeCompare(b.version.family) ||
      b.version.version - a.version.version,
  )
}

export function nextVersionNumber(
  catalogs: Record<string, BillingCatalog>,
  family: string,
): number {
  let max = 0
  for (const catalog of Object.values(catalogs))
    for (const plan of catalog.plans)
      if (plan.family === family) max = Math.max(max, plan.version)
  return max + 1
}

export function termsKey(version: PlanVersion): string {
  const {
    id: _id,
    version: _v,
    state: _s,
    created_at: _c,
    published_at: _p,
    retired_at: _r,
    preview: _preview,
    ...terms
  } = version
  return JSON.stringify(terms)
}

export function catalogDrift(catalogs: Record<string, BillingCatalog>) {
  const regions = Object.keys(catalogs)
  const sets = new Set<string>()
  for (const region of regions)
    for (const plan of catalogs[region]!.plans) sets.add(planSet(plan))
  const drift: string[] = []
  for (const set of [...sets].toSorted()) {
    const terms = regions.map((region) => {
      const current = catalogs[region]!.plans.find(
        (plan) => planSet(plan) === set && plan.state === "published",
      )
      return current ? termsKey(current) : null
    })
    if (new Set(terms).size > 1) drift.push(set)
  }
  return drift
}

export function pricingVersions(catalogs: Record<string, BillingCatalog>) {
  return Object.fromEntries(
    Object.entries(catalogs).map(([region, c]) => [region, c.pricing_version]),
  )
}
