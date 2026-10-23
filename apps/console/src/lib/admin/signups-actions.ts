"use server"

import { revalidatePath } from "next/cache"

import { createServerClient } from "@/lib/supabase/server"

import { canApprovePlatformSignups } from "./permissions"
import {
  approveSignup,
  listSignupReviews,
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
  return user
}

export async function listSignupReviewsAction() {
  await requireSignupApprover()
  return listSignupReviews()
}

export async function approveSignupAction(
  userId: string,
): Promise<SignupReviewResult> {
  const staff = await requireSignupApprover()
  if (!UUID_RE.test(userId)) return { ok: false, error: "Invalid user id" }
  const result = await approveSignup(userId, staff.id)
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
