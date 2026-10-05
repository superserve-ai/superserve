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
}

export async function listTeamsAction(): Promise<TeamDirectoryResponse> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Not authenticated")

  const [teams, selection] = await Promise.all([
    listTeamsForUser(user.id),
    readTeamSelection(),
  ])
  const { memberships } = await completedMemberships(user.id, {
    memberships: teams.map((t) => ({ teamId: t.id, region: t.region })),
    degradedRegions: [],
  })
  const selectable = new Set(memberships.map((m) => `${m.region}:${m.teamId}`))
  const completedTeams = teams.filter((t) =>
    selectable.has(`${t.region}:${t.id}`),
  )
  const active = pickActiveTeam(memberships, selection)
  return {
    teams: completedTeams,
    regions: configuredRegions(),
    activeTeamId: active?.teamId ?? null,
    activeRegion: active?.region ?? null,
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
): Promise<
  | TeamSummary
  | {
      code:
        | "signup_blocked"
        | "google_signup_recovery_required"
        | "team_name_conflict"
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
      return {
        code: "team_name_conflict",
        message:
          "That team name is already taken. Submit a different name to start a new creation.",
      }
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
