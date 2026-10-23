"use server"

import { revalidatePath } from "next/cache"

import {
  AdminBillingRequestError,
  type AdminBillingErrorKind,
} from "@/lib/admin/billing-api"
import {
  cancelPlanChange,
  isUuid,
  schedulePlanChange,
} from "@/lib/admin/team-billing"
import { configuredRegions } from "@/lib/cells"

export type PlanChangeActionResult =
  | { kind: "saved" }
  | { kind: AdminBillingErrorKind }

function validTarget(region: string, teamId: string): boolean {
  return isUuid(teamId) && configuredRegions().includes(region)
}

async function run(
  teamId: string,
  action: () => Promise<unknown>,
): Promise<PlanChangeActionResult> {
  try {
    await action()
  } catch (error) {
    return {
      kind:
        error instanceof AdminBillingRequestError ? error.kind : "unavailable",
    }
  }
  revalidatePath(`/admin/billing/teams/${teamId}`)
  return { kind: "saved" }
}

export async function schedulePlanChangeAction(input: {
  region: string
  teamId: string
  idempotencyKey: string
  targetOffer: string
  reason: string
}): Promise<PlanChangeActionResult> {
  const reason = input.reason.trim()
  if (
    !validTarget(input.region, input.teamId) ||
    !input.idempotencyKey ||
    input.idempotencyKey.length > 200 ||
    !input.targetOffer ||
    !reason ||
    reason.length > 2000
  )
    return { kind: "invalid" }
  return run(input.teamId, () =>
    schedulePlanChange(input.region, input.teamId, {
      idempotencyKey: input.idempotencyKey,
      targetOffer: input.targetOffer,
      reason,
    }),
  )
}

export async function cancelPlanChangeAction(input: {
  region: string
  teamId: string
  changeId: string
  reason: string
}): Promise<PlanChangeActionResult> {
  const reason = input.reason.trim()
  if (
    !validTarget(input.region, input.teamId) ||
    !isUuid(input.changeId) ||
    !reason ||
    reason.length > 2000
  )
    return { kind: "invalid" }
  return run(input.teamId, () =>
    cancelPlanChange(input.region, input.teamId, input.changeId, reason),
  )
}
