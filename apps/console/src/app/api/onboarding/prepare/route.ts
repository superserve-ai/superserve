import { redirect, unstable_rethrow } from "next/navigation"

import { getSignupPlanAction } from "@/lib/api/signup-plan-actions"
import { signupPlanPath } from "@/lib/api/signup-plan-page"
import {
  proAuthReturnPath,
  starterAuthReturnPath,
} from "@/lib/billing/pro-auth-return"

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams
  const params = {
    team: query.get("team") ?? undefined,
    account: query.get("account") ?? undefined,
    billing: query.get("billing") ?? undefined,
  }
  const continuation =
    proAuthReturnPath(query.get("next")) ??
    starterAuthReturnPath(query.get("next"))
  const destination = signupPlanPath(params)
  const retry =
    continuation && params.account
      ? `/auth/auth-code-error?${new URLSearchParams({ reason: "account_setup", account: params.account, next: continuation })}`
      : null
  try {
    const continuationTeam = continuation
      ? (new URL(continuation, request.url).searchParams.get("team") ??
        undefined)
      : undefined
    if (params.team && continuationTeam && params.team !== continuationTeam)
      throw new Error("The checkout team changed")
    await getSignupPlanAction(
      params.team ?? continuationTeam,
      params.account,
      params.billing,
    )
  } catch (error) {
    unstable_rethrow(error)
    redirect(retry ?? `${destination}&setup_error=1`)
  }
  if (continuation && params.account) redirect(continuation)
  // Preparation can succeed against a cached team that the page's fresh
  // membership read no longer sees. Allow only one automatic attempt.
  redirect(`${destination}&setup_attempted=1`)
}
