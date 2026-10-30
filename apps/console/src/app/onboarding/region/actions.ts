"use server"

import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { safeReturnPath } from "@/lib/billing/return-path"
import { configuredRegions } from "@/lib/cells"
import { FIRST_TEAM_REGION_COOKIE } from "@/lib/onboarding/first-team-region"

export async function chooseFirstTeamRegionAction(formData: FormData) {
  const region = String(formData.get("region") ?? "")
  const next = String(formData.get("next") ?? "")
  if (!configuredRegions().includes(region))
    throw new Error("That region is not available")
  ;(await cookies()).set(FIRST_TEAM_REGION_COOKIE, region, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24,
  })
  redirect(safeReturnPath(next) === next ? next : "/onboarding/plan/")
}
