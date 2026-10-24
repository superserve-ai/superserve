"use server"

import type { PlanChangeActionResult } from "@/app/(dashboard)/admin/billing/teams/[team_id]/actions"

export async function requestPlanChangeAction(): Promise<PlanChangeActionResult> {
  return { kind: "unavailable" }
}

export async function undoPlanChangeAction(): Promise<PlanChangeActionResult> {
  return { kind: "unavailable" }
}

export async function assignTeamPlanAction(): Promise<PlanChangeActionResult> {
  return {
    kind: "conflict",
    detail: "plan assignment is not available yet",
  }
}

export async function grantStaffCreditAction(): Promise<PlanChangeActionResult> {
  return { kind: "unavailable" }
}
