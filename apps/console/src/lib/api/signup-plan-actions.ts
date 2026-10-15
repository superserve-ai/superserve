"use server"

import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { getImpersonationContext } from "@/lib/admin/impersonation"
import { getAuthApiKeyAndTeamForUser } from "@/lib/api/proxy-auth"
import {
  parseSignupChoice,
  type SignupPlanContext,
} from "@/lib/api/signup-plan"
import { GoogleSignupRecoveryRequiredError } from "@/lib/auth/google-signup-proof"
import { PLAN_OFFER_COOKIE, readPlanOffer } from "@/lib/auth/plan-preselection"
import { cellFor } from "@/lib/cells"
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
  const teamKey = `${team.region}:${team.teamId}`
  if (expectedTeam && expectedTeam !== teamKey)
    throw new Error("Your active team changed. Reload to continue.")
  const { data, error } = await cellFor(team.region)
    .createAdminClient()
    .from("billing_signup_choice")
    .select("state, offer_key")
    .eq("team_id", team.teamId)
    .maybeSingle()
  // A cell without the onboarding migration still runs the existing signup flow.
  // Once the table exists, every error is blocking rather than proof of completion.
  if (error && error.code !== "42P01" && error.code !== "PGRST205")
    throw new Error("Unable to check your plan. Please retry.")
  const requestedOffer = readPlanOffer(
    (await cookies()).get(PLAN_OFFER_COOKIE)?.value,
    user.id,
  )
  return {
    userId: user.id,
    teamKey,
    ...parseSignupChoice(error ? null : data),
    requestedOffer,
  }
}
