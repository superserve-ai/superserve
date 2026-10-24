"use server"

import { revalidatePath } from "next/cache"

import {
  AdminBillingRequestError,
  type AdminBillingErrorKind,
} from "@/lib/admin/billing-api"
import {
  BILLING_KEY_LIMIT,
  BILLING_REASON_LIMIT,
  withinBillingTextLimit,
  withinBillingByteLimit,
} from "@/lib/admin/billing-text"
import {
  assignTeamPlan,
  grantStaffCredit,
  isUuid,
  PLAN_CHANGE_TARGETS,
  type PlanChangeTarget,
  requestPlanChange,
  undoPlanChange,
} from "@/lib/admin/team-billing"
import { configuredRegions } from "@/lib/cells"

export type ActionFailure = { kind: AdminBillingErrorKind; detail?: string }

export type PlanChangeActionResult =
  | { kind: "saved"; effectiveAt?: string }
  | ActionFailure

function failure(error: unknown): ActionFailure {
  if (!(error instanceof AdminBillingRequestError))
    return { kind: "unavailable" }
  return error.detail
    ? { kind: error.kind, detail: error.detail }
    : { kind: error.kind }
}

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
    const result = failure(error)
    if (result.kind === "conflict" || result.kind === "unavailable")
      revalidatePath(`/admin/billing/teams/${teamId}`)
    return result
  }
  revalidatePath(`/admin/billing/teams/${teamId}`)
  return { kind: "saved" }
}

function validWrite(input: {
  region: string
  teamId: string
  idempotencyKey: string
  reason: string
}): string | null {
  if (
    typeof input.reason !== "string" ||
    typeof input.idempotencyKey !== "string"
  )
    return null
  const reason = input.reason.trim()
  if (
    !validTarget(input.region, input.teamId) ||
    !input.idempotencyKey.trim() ||
    !withinBillingTextLimit(input.idempotencyKey, BILLING_KEY_LIMIT) ||
    !reason ||
    !withinBillingTextLimit(reason, BILLING_REASON_LIMIT)
  )
    return null
  return reason
}

export async function requestPlanChangeAction(input: {
  region: string
  teamId: string
  idempotencyKey: string
  targetPlan: PlanChangeTarget
  reason: string
}): Promise<PlanChangeActionResult> {
  const reason = validWrite(input)
  if (reason === null || !PLAN_CHANGE_TARGETS.includes(input.targetPlan))
    return { kind: "invalid" }
  let effectiveAt: string | undefined
  const result = await run(input.teamId, async () => {
    const change = await requestPlanChange(input.region, input.teamId, {
      idempotencyKey: input.idempotencyKey,
      targetPlan: input.targetPlan,
      reason,
    })
    effectiveAt = change.effective_at
  })
  return result.kind === "saved" ? { kind: "saved", effectiveAt } : result
}

export async function undoPlanChangeAction(input: {
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
    !withinBillingTextLimit(reason, BILLING_REASON_LIMIT)
  )
    return { kind: "invalid" }
  return run(input.teamId, async () => {
    await undoPlanChange(input.region, input.teamId, input.changeId, reason)
  })
}

export async function assignTeamPlanAction(input: {
  region: string
  teamId: string
  idempotencyKey: string
  versionId: string
  reason: string
}): Promise<PlanChangeActionResult> {
  const reason = validWrite(input)
  if (
    reason === null ||
    typeof input.versionId !== "string" ||
    !isUuid(input.versionId)
  )
    return { kind: "invalid" }
  return run(input.teamId, async () => {
    await assignTeamPlan(input.region, input.teamId, {
      idempotencyKey: input.idempotencyKey,
      versionId: input.versionId,
      reason,
    })
  })
}

export async function grantStaffCreditAction(input: {
  region: string
  teamId: string
  idempotencyKey: string
  amountCents: number
  reason: string
}): Promise<PlanChangeActionResult> {
  const reason = validWrite(input)
  if (
    reason === null ||
    !withinBillingByteLimit(input.idempotencyKey, BILLING_KEY_LIMIT) ||
    !withinBillingByteLimit(reason, BILLING_REASON_LIMIT) ||
    typeof input.amountCents !== "number" ||
    !Number.isSafeInteger(input.amountCents) ||
    input.amountCents < 1 ||
    input.amountCents > 100_000_000
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
