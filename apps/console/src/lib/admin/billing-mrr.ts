import { z } from "zod"

import type { AdminBillingErrorKind } from "./billing-api"

export const mrrPlanSchema = z.object({
  key: z.string(),
  name: z.string(),
  teams: z.number().int().nonnegative(),
  mrr_cents: z.number().int().nonnegative(),
})

export const mrrOverviewSchema = z.object({
  as_of: z.string(),
  region: z.string(),
  currency: z.literal("usd"),
  mrr_cents: z.number().int().nonnegative(),
  teams: z.number().int().nonnegative(),
  revenue_teams: z.number().int().nonnegative(),
  plans: z.array(mrrPlanSchema),
})

export type MRRPlan = z.infer<typeof mrrPlanSchema>
export type MRROverview = z.infer<typeof mrrOverviewSchema>

export interface CombinedMRR {
  mrrCents: number
  teams: number
  revenueTeams: number
  plans: MRRPlan[]
  regions: string[]
  failures: RegionFailure[]
}

export interface RegionFailure {
  region: string
  kind: AdminBillingErrorKind
}

export type RegionMRR =
  | { region: string; overview: MRROverview }
  | RegionFailure

const PAYG_KEY = "payg"

export function combineMRR(results: RegionMRR[]): CombinedMRR {
  const plans = new Map<string, MRRPlan>()
  const combined: CombinedMRR = {
    mrrCents: 0,
    teams: 0,
    revenueTeams: 0,
    plans: [],
    regions: [],
    failures: [],
  }
  for (const result of results) {
    if ("kind" in result) {
      combined.failures.push(result)
      continue
    }
    const { region, overview } = result
    combined.regions.push(region)
    combined.mrrCents += overview.mrr_cents
    combined.teams += overview.teams
    combined.revenueTeams += overview.revenue_teams
    for (const plan of overview.plans) {
      const current = plans.get(plan.key)
      plans.set(
        plan.key,
        current
          ? {
              ...current,
              teams: current.teams + plan.teams,
              mrr_cents: current.mrr_cents + plan.mrr_cents,
            }
          : { ...plan },
      )
    }
  }
  combined.plans = [...plans.values()].toSorted(
    (a, b) =>
      Number(a.key === PAYG_KEY) - Number(b.key === PAYG_KEY) ||
      b.mrr_cents - a.mrr_cents ||
      b.teams - a.teams ||
      a.key.localeCompare(b.key),
  )
  return combined
}

export function formatUSD(cents: number, withCents = cents % 100 !== 0) {
  const digits = withCents ? 2 : 0
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(cents / 100)
}

export function mrrShare(planCents: number, totalCents: number): number {
  return totalCents > 0 ? Math.min(Math.max(planCents / totalCents, 0), 1) : 0
}
