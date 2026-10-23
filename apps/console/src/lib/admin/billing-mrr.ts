import { z } from "zod"

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
  asOf: string | null
  plans: MRRPlan[]
  regions: string[]
  unavailableRegions: string[]
}

const PAYG_KEY = "payg"

export function combineMRR(
  results: { region: string; overview: MRROverview | null }[],
): CombinedMRR {
  const plans = new Map<string, MRRPlan>()
  const combined: CombinedMRR = {
    mrrCents: 0,
    teams: 0,
    revenueTeams: 0,
    asOf: null,
    plans: [],
    regions: [],
    unavailableRegions: [],
  }
  for (const { region, overview } of results) {
    if (!overview) {
      combined.unavailableRegions.push(region)
      continue
    }
    combined.regions.push(region)
    combined.mrrCents += overview.mrr_cents
    combined.teams += overview.teams
    combined.revenueTeams += overview.revenue_teams
    if (
      !combined.asOf ||
      Date.parse(overview.as_of) < Date.parse(combined.asOf)
    )
      combined.asOf = overview.as_of
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

export function formatUSD(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100)
}

export function mrrShare(planCents: number, totalCents: number): number {
  return totalCents > 0 ? planCents / totalCents : 0
}
