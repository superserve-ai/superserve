"use server"

import { redirect } from "next/navigation"

import { getImpersonationContext } from "@/lib/admin/impersonation"
import { getAuthApiKeyAndTeamForUser } from "@/lib/api/proxy-auth"
import type { SignupPlanContext } from "@/lib/api/signup-plan"
import { readSignupPlan } from "@/lib/api/signup-plan-read"
import { SignupSetupBlockedError } from "@/lib/api/signup-setup-error"
import { GoogleSignupRecoveryRequiredError } from "@/lib/auth/google-signup-proof"
import {
  proAuthReturnPath,
  starterAuthReturnPath,
  signupPreparationReturnPath,
} from "@/lib/billing/pro-auth-return"
import { cellFor } from "@/lib/cells"
import { recordCheckoutCompleted } from "@/lib/posthog/checkout"
import { createServerClient } from "@/lib/supabase/server"

export async function getSignupPlanAction(
  expectedTeam?: string,
  expectedUser?: string,
  billingReturn?: string,
  paidContinuation?: string,
): Promise<SignupPlanContext> {
  const paidNext =
    proAuthReturnPath(paidContinuation ?? null) ??
    starterAuthReturnPath(paidContinuation ?? null)
  const preparation = new URL(
    "/api/onboarding/prepare/",
    "https://console.superserve.ai",
  )
  if (expectedUser) preparation.searchParams.set("account", expectedUser)
  if (expectedTeam) preparation.searchParams.set("team", expectedTeam)
  if (billingReturn) preparation.searchParams.set("billing", billingReturn)
  if (paidNext) preparation.searchParams.set("next", paidNext)
  const paidRecovery = signupPreparationReturnPath(
    preparation.pathname + preparation.search,
  )
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    const next = new URL("/onboarding/plan/", "https://console.superserve.ai")
    if (expectedTeam) next.searchParams.set("team", expectedTeam)
    if (expectedUser) next.searchParams.set("account", expectedUser)
    if (billingReturn) next.searchParams.set("billing", billingReturn)
    redirect(
      `/auth/signin?next=${encodeURIComponent(paidRecovery ?? next.pathname + next.search)}`,
    )
  }
  if (expectedUser && expectedUser !== user.id)
    throw new SignupSetupBlockedError("account_changed")
  if (await getImpersonationContext(user))
    throw new SignupSetupBlockedError("impersonation")
  // Resolve/provision through the existing signup path, before reading billing state.
  const { apiKey, team } = await getAuthApiKeyAndTeamForUser(
    user,
    new Date().toISOString(),
  ).catch((error: unknown) => {
    if (error instanceof GoogleSignupRecoveryRequiredError)
      redirect(
        `/auth/signup?complete_google=1${paidRecovery ? `&next=${encodeURIComponent(paidRecovery)}` : ""}`,
      )
    throw error
  })
  const context = await readSignupPlan(user.id, team, expectedTeam)
  // The onboarding page's refresh is where a successful Checkout return first
  // sees the paid plan committed; it is the one completion for that page.
  if (
    billingReturn === "success" &&
    context.state === "committed" &&
    context.offer &&
    context.offer !== "free" &&
    context.teamKey === `${team.region}:${team.teamId}`
  )
    recordCheckoutCompleted({
      userId: user.id,
      surface: "onboarding_plan",
      team,
      base: cellFor(team.region).apiBaseUrl,
      apiKey,
    })
  return context
}
