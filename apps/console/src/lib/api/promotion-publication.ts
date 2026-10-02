import "server-only"
import type { User } from "@supabase/supabase-js"

import { DEFAULT_REGION } from "@/lib/cells"
import { createAdminClient } from "@/lib/supabase/admin"

import {
  bindPromotionSignupAccount,
  getPromotionSignupAccountEvidence,
  PromotionEvidenceError,
  registerPromotionSignupAccount,
  registerPromotionSignupDevice,
} from "./promotion-device-evidence"
import { publishPromotionIdentity } from "./promotion-identity"

/** Missing initialization must not turn a failed association into routine absence. */
function routineAbsence(user: User): boolean {
  if (user.app_metadata?.promotion_authority_failed === true) return false
  if (user.app_metadata?.promotion_routine_absence === true) return true
  const cutoff = Date.parse(process.env.PROMOTION_SIGNUP_EVIDENCE_SINCE ?? "")
  const createdAt = Date.parse(user.created_at)
  return (
    Number.isFinite(cutoff) && Number.isFinite(createdAt) && createdAt < cutoff
  )
}

/** Only the original signup flow calls this; normal login never writes provenance. */
export async function publishOriginalSignupEvidence(
  user: User,
  attemptId: string | undefined,
  routineMissing: boolean,
): Promise<void> {
  try {
    // Failure is monotonic. Never clear it using a later callback or login.
    const field = routineMissing
      ? "promotion_routine_absence"
      : "promotion_authority_failed"
    const { error } = await createAdminClient().auth.admin.updateUserById(
      user.id,
      {
        app_metadata: { [field]: true },
      },
    )
    if (error) throw error
    if (!attemptId) return
    const binding = await bindPromotionSignupAccount(user.id, attemptId)
    if (binding === "first_evidence_retained") return
    await publishPromotionIdentity(
      DEFAULT_REGION,
      user.id,
      user,
      new Date().toISOString(),
    )
    await registerPromotionSignupAccount(user.id, attemptId)
  } catch {
    console.warn("Original signup promotion publication unavailable")
  }
}

/** Publication failure affects credit only. Accepted original evidence can recover an uncertain bind. */
export async function publishAccountPromotion(
  region: string,
  user: User,
  observedAt: string,
): Promise<{ authorityUnavailable: boolean }> {
  let authorityUnavailable = false
  try {
    await publishPromotionIdentity(region, user.id, user, observedAt)
  } catch {
    authorityUnavailable = true
  }
  try {
    await getPromotionSignupAccountEvidence(user.id)
    await registerPromotionSignupDevice(region, user.id)
  } catch (error) {
    if (
      !(
        error instanceof PromotionEvidenceError &&
        error.code === "evidence_missing" &&
        routineAbsence(user)
      )
    )
      authorityUnavailable = true
  }
  if (authorityUnavailable)
    console.warn(
      "Promotion publication unavailable; automatic credit withheld",
      { region },
    )
  return { authorityUnavailable }
}
