"use server"

import { redirect } from "next/navigation"

import { createServerClient } from "@/lib/supabase/server"
import { ycAccount, ycTeams } from "@/lib/yc-claims"
import { journeyEnabled } from "@/lib/yc/acceptance-api"
import { requestIdentityReview } from "@/lib/yc/review-api"
import { claimID } from "@/lib/yc/staff-schema"

export async function submitIdentityReview(input: {
  claim_id: string
  team: string
  request_id: string
  verification_link: string
}) {
  try {
    return {
      kind: "saved" as const,
      result: await requestIdentityReview(input),
    }
  } catch {
    return { kind: "unavailable" as const }
  }
}
export async function prepareReviewTeam(locator: string) {
  if (!journeyEnabled()) throw new Error("Review unavailable")
  claimID.parse(locator)
  const user = await ycAccount()
  if (!user)
    redirect(
      `/auth/signin?next=${encodeURIComponent(`/yc/claim?claim=${locator}`)}`,
    )
  await ycTeams(user, true)
  redirect(`/yc/claim?claim=${locator}`)
}
export async function useDifferentClaimAccount(locator: string) {
  claimID.parse(locator)
  const client = await createServerClient()
  const { error } = await client.auth.signOut({ scope: "local" })
  if (error) throw new Error("Could not sign out. Please retry.")
  redirect(
    `/auth/signup?next=${encodeURIComponent(`/yc/claim?claim=${locator}`)}`,
  )
}
