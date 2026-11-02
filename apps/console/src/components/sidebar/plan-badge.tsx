"use client"

import { cn } from "@superserve/ui"

import { useTeamEntry, useTeamPlan } from "@/hooks/use-billing-v2"
import type { TeamPlan } from "@/lib/api/billing-v2"

type Entry = ReturnType<typeof useTeamEntry>["data"]

// The active team's plan as a short tag, or null while it isn't known. A team
// with no plan that isn't on a trial is on legacy pay-as-you-go pricing.
export function planBadge(
  plan: TeamPlan | null | undefined,
  entry: Entry,
): { label: string; paid: boolean } | null {
  if (entry === "trial") return { label: "Trial", paid: false }
  if (entry || plan === undefined) return null
  if (plan === null || plan.kind === "legacy_payg")
    return { label: "PAYG", paid: false }
  if (plan.kind === "custom") return { label: "Enterprise", paid: true }
  return { label: plan.name, paid: plan.kind !== "free" }
}

export function PlanBadge() {
  const badge = planBadge(useTeamPlan(true).data, useTeamEntry(true).data)
  if (!badge) return null
  return (
    <span
      className={cn(
        "shrink-0 border border-dashed px-1.5 py-0.5 font-mono text-[10px] leading-none tracking-[0.12em] uppercase",
        badge.paid ? "border-brand/50 text-brand" : "border-border text-muted",
      )}
    >
      {badge.label}
    </span>
  )
}
