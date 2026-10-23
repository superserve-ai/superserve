import { z } from "zod"

import {
  planGrantSchema,
  planLimitsSchema,
  planMatchingSchema,
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
  family: z.string(),
  version: z.number().int(),
  state: z.enum(["draft", "published", "retired"]),
  public: z.boolean(),
  display_name: z.string(),
  tagline: z.string(),
  features: z.array(z.string()),
  sort_order: z.number().int(),
  display_only: z.boolean(),
  self_serve: z.boolean(),
  monthly_fee_cents: z.number().int().nullable(),
  annual_fee_cents: z.number().int().nullable(),
  credit_schedule: z.array(planGrantSchema),
  matching: planMatchingSchema,
  limits: planLimitsSchema,
  created_at: z.string(),
  published_at: z.string().nullable(),
  retired_at: z.string().nullable(),
  preview: schedulePreviewSchema,
})

export const signupPromotionVersionSchema = z.object({
  id: z.string(),
  promotion: z.enum(["trial", "card_bonus"]),
  version: z.number().int(),
  state: z.enum(["draft", "published", "retired"]),
  amount_cents: z.number().int(),
  published_at: z.string().nullable(),
  retired_at: z.string().nullable(),
})

export const billingCatalogSchema = z.object({
  plans: z.array(planVersionSchema),
  promotions: z.array(signupPromotionVersionSchema),
})

export type PlanGrantIssue = z.infer<typeof planGrantIssueSchema>
export type SchedulePreview = z.infer<typeof schedulePreviewSchema>
export type PlanVersion = z.infer<typeof planVersionSchema>
export type SignupPromotionVersion = z.infer<
  typeof signupPromotionVersionSchema
>
export type BillingCatalog = z.infer<typeof billingCatalogSchema>

export interface PlanDraft {
  family: string
  public: boolean
  display_name: string
  tagline: string
  features: string[]
  sort_order: number
  display_only: boolean
  self_serve: boolean
  monthly_fee_cents: number | null
  annual_fee_cents: number | null
  credit_schedule: PlanVersion["credit_schedule"]
  matching: PlanVersion["matching"]
  limits: PlanVersion["limits"]
}

export function draftFromVersion(version: PlanVersion): PlanDraft {
  return {
    family: version.family,
    public: version.public,
    display_name: version.display_name,
    tagline: version.tagline,
    features: version.features,
    sort_order: version.sort_order,
    display_only: version.display_only,
    self_serve: version.self_serve,
    monthly_fee_cents: version.monthly_fee_cents,
    annual_fee_cents: version.annual_fee_cents,
    credit_schedule: version.credit_schedule,
    matching: version.matching,
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

export interface MergedPromotion {
  promotion: SignupPromotionVersion
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
  const [newest, index] = settled[0]!
  if (reached(newest, "published")) {
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
  for (const [member, i] of settled)
    steps[i] = Object.fromEntries(
      Object.entries(member.states).map(([region, state]) => [
        region,
        state === "published" ? ["retire"] : [],
      ]),
    )
  return steps
}

// Publishing a promotion retires the one it replaces, so only the newest
// published promotion is created where it is missing.
export function promotionGroupSync(group: SyncMember[]): Steps[] {
  const steps = group.map((m) => noSteps(m.states))
  const newest = group
    .map((m, i) => [m, i] as const)
    .filter(([m]) => reached(m, "published"))
    .toSorted(([a], [b]) => b.version - a.version)[0]
  if (newest)
    steps[newest[1]] = Object.fromEntries(
      Object.entries(newest[0].states).map(([region, state]) => [
        region,
        state === "missing" ? ["create"] : [],
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

export function mergeCatalogs(catalogs: Record<string, BillingCatalog>) {
  const regions = Object.keys(catalogs)
  const versions = new Map<string, MergedVersion>()
  const promotions = new Map<string, MergedPromotion>()
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
    for (const promotion of catalogs[region]!.promotions) {
      const merged = promotions.get(promotion.id) ?? {
        promotion,
        states: Object.fromEntries(regions.map((r) => [r, "missing"])),
        steps: {},
      }
      merged.states[region] = promotion.state
      promotions.set(promotion.id, merged)
    }
  }
  applyGroups(
    [...versions.values()],
    (m) => m.version.family,
    (m) => m.version.version,
    planGroupSync,
  )
  applyGroups(
    [...promotions.values()],
    (m) => m.promotion.promotion,
    (m) => m.promotion.version,
    promotionGroupSync,
  )
  return {
    versions: [...versions.values()].toSorted(
      (a, b) =>
        a.version.sort_order - b.version.sort_order ||
        a.version.family.localeCompare(b.version.family) ||
        b.version.version - a.version.version,
    ),
    promotions: [...promotions.values()].toSorted(
      (a, b) =>
        a.promotion.promotion.localeCompare(b.promotion.promotion) ||
        b.promotion.version - a.promotion.version,
    ),
  }
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

export function nextPromotionVersion(
  catalogs: Record<string, BillingCatalog>,
  promotion: string,
): number {
  let max = 0
  for (const catalog of Object.values(catalogs))
    for (const p of catalog.promotions)
      if (p.promotion === promotion) max = Math.max(max, p.version)
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
  const families = new Set<string>()
  for (const region of regions)
    for (const plan of catalogs[region]!.plans) families.add(plan.family)
  const drift: string[] = []
  for (const family of [...families].toSorted()) {
    const terms = regions.map((region) => {
      const current = catalogs[region]!.plans.find(
        (plan) => plan.family === family && plan.state === "published",
      )
      return current ? termsKey(current) : null
    })
    if (new Set(terms).size > 1) drift.push(family)
  }
  for (const promotion of ["trial", "card_bonus"] as const) {
    const amounts = regions.map(
      (region) =>
        catalogs[region]!.promotions.find(
          (p) => p.promotion === promotion && p.state === "published",
        )?.amount_cents ?? null,
    )
    if (new Set(amounts).size > 1) drift.push(promotion)
  }
  return drift
}
