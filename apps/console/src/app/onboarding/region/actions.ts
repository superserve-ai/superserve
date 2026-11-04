"use server"

import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { safeReturnPath } from "@/lib/billing/return-path"
import { configuredRegions } from "@/lib/cells"
import {
  FIRST_TEAM_REGION_COOKIE,
  firstTeamRegionValue,
} from "@/lib/onboarding/first-team-region"
import { createServerClient } from "@/lib/supabase/server"

export async function chooseFirstTeamRegionAction(formData: FormData) {
  const region = String(formData.get("region") ?? "")
  const next = String(formData.get("next") ?? "")
  if (!configuredRegions().includes(region))
    throw new Error("That region is not available")
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Not authenticated")
  ;(await cookies()).set(
    FIRST_TEAM_REGION_COOKIE,
    firstTeamRegionValue(user.id, region),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24,
    },
  )
  redirect(safeReturnPath(next) === next ? next : "/onboarding/plan/")
}
