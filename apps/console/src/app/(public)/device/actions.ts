"use server"

import { serializeTeamSelection as teamKey } from "@/lib/api/active-team"
import { getOrCreateTeamForUser } from "@/lib/api/api-key-mint"
import { readSignupPlan } from "@/lib/api/signup-plan-read"
import {
  approveDeviceCode,
  DeviceLoginError,
  denyDeviceCode,
  normalizeUserCode,
} from "@/lib/auth/device-login"
import { GoogleSignupRecoveryRequiredError } from "@/lib/auth/google-signup-proof"
import {
  SignupRestrictedError,
  SIGNUP_RESTRICTED_MESSAGE,
} from "@/lib/auth/signup-restrictions"
import {
  isSignupReviewBlocked,
  SIGNUP_REVIEW_PENDING_MESSAGE,
} from "@/lib/auth/signup-review"
import { createServerClient } from "@/lib/supabase/server"

export type DeviceApprovalResult =
  | { status: "approved" }
  | { status: "commit_free_plan"; teamKey: string }
  | { status: "redirect"; to: string }
  | { status: "error"; message: string }

/**
 * Approves a CLI login for the user's active team. A brand-new team is still
 * choosing a plan, so the first call hands back its team key for the page to
 * commit Free through the normal proxy path; the page then calls again.
 */
export async function approveDeviceAction(
  code: string,
  shownTeam: string | null,
): Promise<DeviceApprovalResult> {
  const userCode = normalizeUserCode(code)
  if (!userCode) return { status: "error", message: "Invalid code." }
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { status: "error", message: "Sign in to continue." }
  if (isSignupReviewBlocked(user))
    return { status: "error", message: SIGNUP_REVIEW_PENDING_MESSAGE }

  try {
    const team = await getOrCreateTeamForUser(user, new Date().toISOString())
    // The key must go to the team the page showed, not one selected since.
    if (shownTeam && teamKey(team) !== shownTeam)
      return {
        status: "error",
        message: "Your active team changed. Reload this page to continue.",
      }
    const plan = await readSignupPlan(user.id, team)
    if (plan.state === "selecting")
      return { status: "commit_free_plan", teamKey: plan.teamKey }
    await approveDeviceCode(userCode, user, team)
    return { status: "approved" }
  } catch (error) {
    if (error instanceof SignupRestrictedError)
      return { status: "error", message: SIGNUP_RESTRICTED_MESSAGE }
    if (error instanceof GoogleSignupRecoveryRequiredError)
      return {
        status: "redirect",
        to: `/auth/signup?complete_google=1&next=${encodeURIComponent(`/device?code=${userCode}`)}`,
      }
    if (error instanceof DeviceLoginError)
      return { status: "error", message: error.message }
    throw error
  }
}

export async function denyDeviceAction(
  code: string,
): Promise<{ status: "denied" } | { status: "error"; message: string }> {
  const userCode = normalizeUserCode(code)
  if (!userCode) return { status: "error", message: "Invalid code." }
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { status: "error", message: "Sign in to continue." }
  try {
    await denyDeviceCode(userCode)
    return { status: "denied" }
  } catch (error) {
    if (error instanceof DeviceLoginError)
      return { status: "error", message: error.message }
    throw error
  }
}
