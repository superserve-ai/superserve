import { redirect, unstable_rethrow } from "next/navigation"

import { getSignupPlanAction } from "@/lib/api/signup-plan-actions"
import { signupPlanPath } from "@/lib/api/signup-plan-page"

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams
  const params = {
    team: query.get("team") ?? undefined,
    account: query.get("account") ?? undefined,
    billing: query.get("billing") ?? undefined,
  }
  const destination = signupPlanPath(params)
  try {
    await getSignupPlanAction(params.team, params.account, params.billing)
  } catch (error) {
    unstable_rethrow(error)
    redirect(`${destination}&setup_error=1`)
  }
  // Preparation can succeed against a cached team that the page's fresh
  // membership read no longer sees. Allow only one automatic attempt.
  redirect(`${destination}&setup_attempted=1`)
}
