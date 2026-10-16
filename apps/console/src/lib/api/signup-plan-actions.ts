"use server"

import { redirect } from "next/navigation"

import { getImpersonationContext } from "@/lib/admin/impersonation"
import { getAuthApiKeyAndTeamForUser } from "@/lib/api/proxy-auth"
import type { SignupPlanContext } from "@/lib/api/signup-plan"
import { readSignupPlan } from "@/lib/api/signup-plan-read"
import { GoogleSignupRecoveryRequiredError } from "@/lib/auth/google-signup-proof"
import { createServerClient } from "@/lib/supabase/server"

export async function getSignupPlanAction(
  expectedTeam?: string,
  expectedUser?: string,
  billingReturn?: string,
): Promise<SignupPlanContext> {
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
      `/auth/signin?next=${encodeURIComponent(next.pathname + next.search)}`,
    )
  }
  if (expectedUser && expectedUser !== user.id)
    throw new Error(
      "Your account changed. Sign in to the account that started checkout.",
    )
  if (await getImpersonationContext(user))
    throw new Error("Plan setup is unavailable during impersonation")
  // Resolve/provision through the existing signup path, before reading billing state.
  const { team } = await getAuthApiKeyAndTeamForUser(
    user,
    new Date().toISOString(),
  ).catch((error: unknown) => {
    if (error instanceof GoogleSignupRecoveryRequiredError)
      redirect("/auth/signup?complete_google=1")
    throw error
  })
  return readSignupPlan(user.id, team, expectedTeam)
}
