"use server"

import { revalidatePath } from "next/cache"

import {
  AdminBillingRequestError,
  type AdminBillingErrorKind,
} from "@/lib/admin/billing-api"
import { hasImpersonationCookie } from "@/lib/admin/impersonation"
import {
  cancelPlanChange,
  grantStaffCredit,
  isUuid,
  schedulePlanChange,
} from "@/lib/admin/team-billing"
import { configuredRegions } from "@/lib/cells"

export type PlanChangeActionResult =
  | { kind: "saved" }
  | { kind: AdminBillingErrorKind | "impersonating" }

function validTarget(region: string, teamId: string): boolean {
  return isUuid(teamId) && configuredRegions().includes(region)
}

async function run(
  teamId: string,
  action: () => Promise<unknown>,
): Promise<PlanChangeActionResult> {
  if (await hasImpersonationCookie()) return { kind: "impersonating" }
  try {
    await action()
  } catch (error) {
    const kind =
      error instanceof AdminBillingRequestError ? error.kind : "unavailable"
    if (kind === "conflict" || kind === "unavailable")
      revalidatePath(`/admin/billing/teams/${teamId}`)
    return { kind }
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
  if (
    typeof input.reason !== "string" ||
    typeof input.idempotencyKey !== "string" ||
    typeof input.targetOffer !== "string"
  )
    return { kind: "invalid" }
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
  if (typeof input.reason !== "string" || typeof input.changeId !== "string")
    return { kind: "invalid" }
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

export async function grantStaffCreditAction(input: {
  region: string
  teamId: string
  idempotencyKey: string
  amountCents: number
  reason: string
}): Promise<PlanChangeActionResult> {
  if (
    typeof input.reason !== "string" ||
    typeof input.idempotencyKey !== "string" ||
    typeof input.amountCents !== "number"
  )
    return { kind: "invalid" }
  const reason = input.reason.trim()
  if (
    !validTarget(input.region, input.teamId) ||
    !input.idempotencyKey ||
    input.idempotencyKey.length > 200 ||
    !Number.isSafeInteger(input.amountCents) ||
    input.amountCents < 1 ||
    input.amountCents > 100_000_000 ||
    !reason ||
    reason.length > 2000
  )
    return { kind: "invalid" }
  return run(input.teamId, () =>
    grantStaffCredit(input.region, input.teamId, {
      idempotencyKey: input.idempotencyKey,
      amountCents: input.amountCents,
      reason,
    }),
  )
}
