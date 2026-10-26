"use server"

import { revalidatePath } from "next/cache"

import { getImpersonationTeamId } from "@/lib/admin/impersonation"
import { createServerClient } from "@/lib/supabase/server"

import { AdminBillingRequestError } from "./billing-api"
import { assignEnterprisePlan } from "./enterprise-plan"
import { canApprovePlatformSignups, canWriteAdminBilling } from "./permissions"
import {
  approveSignup,
  rejectSignup,
  type SignupReviewResult,
} from "./signup-approval"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function requireSignupApprover() {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user || !canApprovePlatformSignups(user)) {
    throw new Error("Forbidden: signup approval access required")
  }
  if (await getImpersonationTeamId(user))
    throw new AdminBillingRequestError("read_only_impersonation")
  return user
}

export async function approveSignupAction(
  userId: string,
  planVersionId: string,
): Promise<SignupReviewResult> {
  const staff = await requireSignupApprover()
  if (!canWriteAdminBilling(staff))
    return { ok: false, error: "Granting access needs billing write access." }
  if (!UUID_RE.test(userId)) return { ok: false, error: "Invalid user id" }
  if (planVersionId && !UUID_RE.test(planVersionId))
    return { ok: false, error: "Choose the Enterprise plan to assign." }
  let result: SignupReviewResult
  try {
    result = await approveSignup(
      userId,
      staff.id,
      planVersionId,
      async (team, frozenVersionId) => {
        await assignEnterprisePlan(team, userId, frozenVersionId)
      },
    )
  } catch (error) {
    console.error("Enterprise access grant failed", error)
    result = {
      ok: false,
      error:
        error instanceof AdminBillingRequestError && error.kind === "conflict"
          ? "The plan can't be assigned: pricing v2 is off, the plan was retired, or this applicant was already given a different plan. The applicant is still held."
          : "Access was not granted yet. The applicant is still held; try again.",
    }
  }
  revalidatePath("/admin/signups")
  return result
}

export async function rejectSignupAction(
  userId: string,
): Promise<SignupReviewResult> {
  const staff = await requireSignupApprover()
  if (!UUID_RE.test(userId)) return { ok: false, error: "Invalid user id" }
  const result = await rejectSignup(userId, staff.id)
  revalidatePath("/admin/signups")
  return result
}
