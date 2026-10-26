import "server-only"
import type { User } from "@supabase/supabase-js"

import { getImpersonationTeamId } from "@/lib/admin/impersonation"
import {
  canApprovePlatformSignups,
  canWriteAdminBilling,
} from "@/lib/admin/permissions"
import { signupReviewStatus } from "@/lib/auth/signup-review"
import { createAdminClient } from "@/lib/supabase/admin"
import { createServerClient } from "@/lib/supabase/server"

declare const authorityBrand: unique symbol
export type EnterpriseProvisioningAuthority = {
  readonly [authorityBrand]: true
}
interface Binding {
  user: User
  region: string
  planVersionId: string
  expiresAt: number
}
const authorities = new WeakMap<EnterpriseProvisioningAuthority, Binding>()

/** A request-local capability, never serialized or accepted from a browser. */
export async function authorizeEnterpriseProvisioning(
  userId: string,
  region: string,
  planVersionId: string,
): Promise<EnterpriseProvisioningAuthority> {
  const { data, error } = await (await createServerClient()).auth.getUser()
  const staff = data.user
  if (
    error ||
    !staff ||
    !canApprovePlatformSignups(staff) ||
    !canWriteAdminBilling(staff) ||
    (await getImpersonationTeamId(staff))
  )
    throw new Error("Forbidden: Enterprise provisioning authority required")
  const admin = createAdminClient()
  const { data: decision, error: decisionError } = await admin
    .from("signup_review_decision")
    .select("user_id,decision,plan_version_id,region")
    .eq("user_id", userId)
    .single()
  if (
    decisionError ||
    !decision ||
    decision.user_id !== userId ||
    decision.decision !== "approved" ||
    decision.plan_version_id !== planVersionId ||
    decision.region !== region
  )
    throw new Error("Enterprise provisioning decision mismatch")
  const { data: applicant, error: applicantError } =
    await admin.auth.admin.getUserById(userId)
  if (
    applicantError ||
    !applicant.user ||
    applicant.user.id !== userId ||
    signupReviewStatus(applicant.user) !== "pending"
  )
    throw new Error("Only held applicants are provisioned by staff")
  const authority = Object.freeze({}) as EnterpriseProvisioningAuthority
  authorities.set(authority, {
    user: structuredClone(applicant.user),
    region,
    planVersionId,
    expiresAt: Date.now() + 5 * 60_000,
  })
  return authority
}

/** Every delegated operation is checked against the privately retained tuple. */
export function enterpriseProvisioningContext(
  authority: EnterpriseProvisioningAuthority,
  userId: string,
  region?: string,
  operationId?: string,
): { user: User; region: string; planVersionId: string } {
  const binding = authorities.get(authority)
  if (
    !binding ||
    binding.expiresAt <= Date.now() ||
    binding.user.id !== userId ||
    (region !== undefined && binding.region !== region) ||
    (operationId !== undefined && operationId !== userId)
  )
    throw new Error("Forbidden: Enterprise provisioning binding mismatch")
  return {
    user: structuredClone(binding.user),
    region: binding.region,
    planVersionId: binding.planVersionId,
  }
}
