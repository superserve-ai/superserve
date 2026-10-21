"use server"

import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import {
  ycAccount,
  ycProof,
  ycRequest,
  ycTeams,
  YC_COOKIE,
  YCManualReviewError,
  type YCClaim,
} from "@/lib/yc-claims"
import { journeyEnabled } from "@/lib/yc/acceptance-api"

export async function bindYCClaim(form: FormData) {
  const user = await ycAccount().catch(() => null)
  if (!user) redirect("/auth/signin?next=%2Fyc%2Fclaim&offer=yc_2026")
  let result = "review"
  let acceptedClaim: string | null = null
  try {
    const proof = await ycProof()
    if (!proof) throw new Error("Email confirmation required")
    const teams = await ycTeams(user)
    const team = teams.find(
      (t) => `${t.region}:${t.teamId}` === form.get("team"),
    )
    if (!team) throw new Error("Authorized team required")
    const claim = await ycRequest<YCClaim>(
      "bind",
      { ...proof, user_id: user.id, team_id: team.teamId },
      team.region,
    )
    result = claim.state === "bound" ? "bound" : "review"
    if (claim.state === "bound") {
      ;(await cookies()).delete(YC_COOKIE)
      acceptedClaim = claim.id
    }
  } catch (error) {
    result = error instanceof YCManualReviewError ? "review" : "retry"
  }
  if (acceptedClaim && journeyEnabled())
    redirect(`/yc/accept?claim=${encodeURIComponent(acceptedClaim)}`)
  redirect(`/yc/claim?result=${result}`)
}

export async function prepareYCTeam() {
  const user = await ycAccount().catch(() => null)
  if (!user) redirect("/auth/signin?next=%2Fyc%2Fclaim&offer=yc_2026")
  let result = "ready"
  try {
    const proof = await ycProof()
    if (!proof) throw new Error("Confirmation required")
    const { claims } = await ycRequest<{ claims: YCClaim[] }>("claims", {
      user_id: user.id,
    })
    if (
      !claims.some(
        (c) =>
          c.id === proof.id &&
          c.state === "confirmed" &&
          c.confirmation_status !== "expired",
      )
    )
      throw new Error("Confirmed claim required")
    await ycTeams(user, true)
  } catch (error) {
    result = error instanceof YCManualReviewError ? "review" : "retry"
  }
  redirect(`/yc/claim?result=${result}`)
}
