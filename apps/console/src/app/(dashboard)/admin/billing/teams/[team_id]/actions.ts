"use server"

import { revalidatePath } from "next/cache"

import {
  AdminBillingRequestError,
  type AdminBillingErrorKind,
} from "@/lib/admin/billing-api"
import {
  cancelPlanChange,
  grantStaffCredit,
  isUuid,
  previewPlanChange,
  schedulePlanChange,
  type PlanChangePreview,
} from "@/lib/admin/team-billing"
import { configuredRegions } from "@/lib/cells"

export type ActionFailure = { kind: AdminBillingErrorKind; detail?: string }

export type PlanChangeActionResult = { kind: "saved" } | ActionFailure

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

export type PlanChangePreviewResult =
  | { kind: "preview"; preview: PlanChangePreview }
  | ActionFailure

export async function previewPlanChangeAction(input: {
  region: string
  teamId: string
  targetOffer: string
}): Promise<PlanChangePreviewResult> {
  if (
    typeof input.targetOffer !== "string" ||
    !input.targetOffer ||
    input.targetOffer.length > 100 ||
    !validTarget(input.region, input.teamId)
  )
    return { kind: "invalid" }
  try {
    return {
      kind: "preview",
      preview: await previewPlanChange(
        input.region,
        input.teamId,
        input.targetOffer,
      ),
    }
  } catch (error) {
    return failure(error)
  }
}
