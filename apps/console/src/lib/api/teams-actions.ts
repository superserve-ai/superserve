"use server"

import { cookies } from "next/headers"

import {
  ACTIVE_TEAM_COOKIE,
  pickActiveTeam,
  readTeamSelection,
  serializeTeamSelection,
  type TeamSelection,
} from "@/lib/api/active-team"
import { PromotionEvidenceError } from "@/lib/api/promotion-device-evidence"
import { isPersonalTeam, ownsTeam, renameTeam } from "@/lib/api/team-conversion"
import {
  invalidateMembershipDirectory,
  listTeamsForUser,
  membershipExistsInCell,
} from "@/lib/api/team-directory"
import {
  completedMemberships,
  provisionTeam,
  type ProvisionedTeam,
} from "@/lib/api/team-provisioning"
import { GoogleSignupRecoveryRequiredError } from "@/lib/auth/google-signup-proof"
import {
  SignupRestrictedError,
  SIGNUP_RESTRICTED_MESSAGE,
} from "@/lib/auth/signup-restrictions"
import { configuredRegions, DEFAULT_REGION } from "@/lib/cells"
import { createServerClient } from "@/lib/supabase/server"

export interface TeamSummary {
  id: string
  name: string
  region: string
}

export interface TeamDirectoryResponse {
  teams: TeamSummary[]
  regions: string[]
  activeTeamId: string | null
  activeRegion: string | null
  // The active team when it is the user's own account team, which a team
  // creation converts in place instead of creating another team.
  convertibleTeam?: TeamSummary | null
}

async function readTeamDirectory(userId: string) {
  const [teams, selection] = await Promise.all([
    listTeamsForUser(userId),
    readTeamSelection(),
  ])
  const { memberships } = await completedMemberships(userId, {
    memberships: teams.map((t) => ({ teamId: t.id, region: t.region })),
    degradedRegions: [],
  })
  const selectable = new Set(memberships.map((m) => `${m.region}:${m.teamId}`))
  const completedTeams = teams.filter((t) =>
    selectable.has(`${t.region}:${t.id}`),
  )
  const active = pickActiveTeam(memberships, selection)
  const activeTeam =
    completedTeams.find(
      (t) => t.id === active?.teamId && t.region === active.region,
    ) ?? null
  return { teams: completedTeams, activeTeam }
}

export async function listTeamsAction(): Promise<TeamDirectoryResponse> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Not authenticated")

  const { teams, activeTeam } = await readTeamDirectory(user.id)
  let convertibleTeam: TeamSummary | null = null
  if (activeTeam && isPersonalTeam(activeTeam, user.email)) {
    try {
      if (await ownsTeam(activeTeam.region, user.id, activeTeam.id))
        convertibleTeam = activeTeam
    } catch (error) {
      // The create form falls back to a new team; the action rechecks anyway.
      console.error("team directory: owner lookup failed:", error)
    }
  }
  return {
    teams,
    regions: configuredRegions(),
    activeTeamId: activeTeam?.id ?? null,
    activeRegion: activeTeam?.region ?? null,
    convertibleTeam,
  }
}

async function storeTeamSelection(selection: TeamSelection): Promise<void> {
  const store = await cookies()
  store.set(ACTIVE_TEAM_COOKIE, serializeTeamSelection(selection), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  })
}

export async function setActiveTeamAction(
  teamId: string,
  region: string,
): Promise<void> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Not authenticated")

  if (
    !configuredRegions().includes(region) ||
    !(await membershipExistsInCell(region, user.id, teamId)) ||
    !(
      await completedMemberships(user.id, {
        memberships: [{ region, teamId }],
        degradedRegions: [],
      })
    ).memberships.length
  ) {
    throw new Error("You are not a member of that team")
  }

  await storeTeamSelection({ region, teamId })
}

export async function createTeamAction(
  name: string,
  region?: string,
  operationId?: string,
  convertTeamId?: string,
): Promise<
  | TeamSummary
  | {
      code:
        | "signup_blocked"
        | "google_signup_recovery_required"
        | "team_name_conflict"
        | "team_conversion_unavailable"
      message: string
    }
> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const observedAt = new Date().toISOString()
  if (!user) throw new Error("Not authenticated")

  if (!operationId || operationId === user.id)
    throw new Error("A distinct team creation operation is required")
  const trimmed = name.trim()
  if (!trimmed) throw new Error("Team name is required")

  const targetRegion = region ?? DEFAULT_REGION
  if (!configuredRegions().includes(targetRegion)) {
    throw new Error(`Region ${targetRegion} is not available`)
  }

  // The form asks to convert the user's own account team. A conversion never
  // falls back to a new team: that is the outcome the user did not ask for.
  if (convertTeamId) {
    const { teams } = await readTeamDirectory(user.id)
    const target = teams.find(
      (t) => t.id === convertTeamId && t.region === targetRegion,
    )
    if (!target || !(await ownsTeam(targetRegion, user.id, target.id)))
      return teamConversionUnavailable()
    // A retry after the converted response was lost finds the new name.
    if (target.name !== trimmed) {
      if (!isPersonalTeam(target, user.email))
        return teamConversionUnavailable()
      const renamed = await renameTeam(
        targetRegion,
        target.id,
        target.name,
        trimmed,
      )
      if (renamed === "name_taken") return teamNameConflict()
      if (renamed === "changed") return teamConversionUnavailable()
    }
    invalidateMembershipDirectory(user.id)
    await storeTeamSelection({ region: targetRegion, teamId: target.id })
    return { id: target.id, name: trimmed, region: targetRegion }
  }

  let team: ProvisionedTeam
  try {
    team = await provisionTeam(
      targetRegion,
      user.id,
      user.email ?? user.id,
      trimmed,
      { user, observedAt },
      operationId,
    )
  } catch (error) {
    if (
      error instanceof PromotionEvidenceError &&
      error.code === "team_name_conflict"
    )
      return teamNameConflict()
    if (error instanceof SignupRestrictedError)
      return { code: "signup_blocked", message: SIGNUP_RESTRICTED_MESSAGE }
    if (error instanceof GoogleSignupRecoveryRequiredError)
      return { code: "google_signup_recovery_required", message: error.message }
    throw error
  }

  invalidateMembershipDirectory(user.id)
  await storeTeamSelection({ region: targetRegion, teamId: team.id })

  return { id: team.id, name: team.name, region: targetRegion }
}

function teamNameConflict() {
  return {
    code: "team_name_conflict" as const,
    message:
      "That team name is already taken. Submit a different name to start a new creation.",
  }
}

function teamConversionUnavailable() {
  return {
    code: "team_conversion_unavailable" as const,
    message:
      "Your account can no longer be converted. Reload the page and try again.",
  }
}
