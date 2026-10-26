import { redirect, unstable_rethrow } from "next/navigation"

import { getSignupPlanAction } from "@/lib/api/signup-plan-actions"
import { signupPlanPath } from "@/lib/api/signup-plan-page"
import { SignupSetupBlockedError } from "@/lib/api/signup-setup-error"
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
  let continuation =
    proAuthReturnPath(query.get("next")) ??
    starterAuthReturnPath(query.get("next"))
  const nestedTeam = continuation
    ? (new URL(continuation, request.url).searchParams.get("team") ?? undefined)
    : undefined
  const conflictingTeams = !!(
    params.team &&
    nestedTeam &&
    params.team !== nestedTeam
  )
  if (continuation && params.team && !nestedTeam) {
    // The outer preparation locator is just as binding as a paid-page locator.
    // Normalize it before building any error/sign-in recovery destination.
    const pinned = new URL(continuation, request.url)
    pinned.searchParams.set("team", params.team)
    continuation = pinned.pathname + pinned.search
  }
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
    if (conflictingTeams) throw new SignupSetupBlockedError("team_conflict")
    await getSignupPlanAction(
      params.team ?? continuationTeam,
      params.account,
      params.billing,
      continuation ?? undefined,
    )
  } catch (error) {
    unstable_rethrow(error)
    if (retry && error instanceof SignupSetupBlockedError) {
      const terminal = new URL(retry, request.url)
      terminal.searchParams.set("reason", error.reason)
      redirect(terminal.pathname + terminal.search)
    }
    redirect(retry ?? `${destination}&setup_error=1`)
  }
  if (continuation && params.account) redirect(continuation)
  // Preparation can succeed against a cached team that the page's fresh
  // membership read no longer sees. Allow only one automatic attempt.
  redirect(`${destination}&setup_attempted=1`)
}
