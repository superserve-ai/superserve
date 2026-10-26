import "server-only"
import type { User } from "@supabase/supabase-js"

import {
  enterpriseProvisioningContext,
  type EnterpriseProvisioningAuthority,
} from "@/lib/admin/enterprise-provisioning-authority"
import { DEFAULT_REGION } from "@/lib/cells"
import type { DiagnosticStage } from "@/lib/fingerprint/diagnostics"
import {
  fingerprintDiagnostics,
  promotionDiagnosticFailure,
} from "@/lib/fingerprint/diagnostics-server"
import { createAdminClient } from "@/lib/supabase/admin"

import {
  bindPromotionSignupAccount,
  getPromotionSignupAccountEvidence,
  getPromotionSignupAccountEvidenceForEnterprise,
  getPromotionSignupEligibilityForTrustedSignup,
  PromotionEvidenceError,
  registerPromotionSignupAccount,
  registerPromotionSignupDevice,
  registerPromotionSignupDeviceForEnterprise,
} from "./promotion-device-evidence"
import type { PromotionSignupEligibility } from "./promotion-device-evidence"
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
  signupAttemptId?: string,
): Promise<PromotionSignupEligibility | undefined> {
  const diagnostic = fingerprintDiagnostics({
    userId: user.id,
    captureAttemptId: attemptId,
    signupAttemptId,
  })
  let stage: DiagnosticStage = "account_marker"
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
    if (attemptId) {
      stage = "attachment"
      const binding = await bindPromotionSignupAccount(user.id, attemptId)
      diagnostic.record({
        stage,
        outcome:
          binding === "first_evidence_retained" ? "skipped" : "succeeded",
        reason: binding,
      })
      if (binding !== "first_evidence_retained") {
        stage = "identity_publication"
        await publishPromotionIdentity(
          DEFAULT_REGION,
          user.id,
          user,
          new Date().toISOString(),
        )
        diagnostic.record({ stage, outcome: "succeeded", reason: "completed" })
        stage = "device_publication"
        const registration = await registerPromotionSignupAccount(
          user.id,
          attemptId,
        )
        diagnostic.record({
          stage,
          outcome: registration === "owner" ? "succeeded" : "rejected",
          reason: registration,
        })
      }
    } else {
      diagnostic.record({
        stage: "attachment",
        outcome: "skipped",
        reason: "no_attested_attempt",
      })
    }
    stage = "eligibility_snapshot"
    return await getPromotionSignupEligibilityForTrustedSignup(user.id)
  } catch (error) {
    diagnostic.record({ stage, ...promotionDiagnosticFailure(error) })
    console.warn("Original signup promotion publication unavailable")
    return undefined
  }
}

/** Publication failure affects credit only. Accepted original evidence can recover an uncertain bind. */
export async function publishAccountPromotion(
  region: string,
  user: User,
  observedAt: string,
): Promise<{ authorityUnavailable: boolean }> {
  return publishAccountPromotionFor(region, user, observedAt)
}

export async function publishEnterpriseAccountPromotion(
  region: string,
  user: User,
  observedAt: string,
  authority: EnterpriseProvisioningAuthority,
): Promise<{ authorityUnavailable: boolean }> {
  enterpriseProvisioningContext(authority, user.id, region)
  return publishAccountPromotionFor(region, user, observedAt, authority)
}

async function publishAccountPromotionFor(
  region: string,
  user: User,
  observedAt: string,
  authority?: EnterpriseProvisioningAuthority,
): Promise<{ authorityUnavailable: boolean }> {
  let authorityUnavailable = false
  try {
    await publishPromotionIdentity(region, user.id, user, observedAt)
  } catch {
    authorityUnavailable = true
  }
  try {
    if (authority) {
      await getPromotionSignupAccountEvidenceForEnterprise(user.id, authority)
      await registerPromotionSignupDeviceForEnterprise(
        region,
        user.id,
        authority,
      )
    } else {
      await getPromotionSignupAccountEvidence(user.id)
      await registerPromotionSignupDevice(region, user.id)
    }
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
