import { cookies } from "next/headers"

import {
  listTeamMembershipsForUser,
  type TeamMembership,
} from "@/lib/api/team-directory"
import { completedMemberships } from "@/lib/api/team-provisioning"

export const ACTIVE_TEAM_METADATA_KEY = "active_team"

// The user's selected team, stored as "<region>:<teamId>". The cookie is a
// preference, never an authorization: every read validates it against the
// user's live memberships and silently falls back when it no longer matches
// (membership revoked, team moved to another cell, cookie hand-edited).
export const ACTIVE_TEAM_COOKIE = "ss-active-team"

export interface TeamSelection {
  region: string
  teamId: string
}

export function parseTeamSelection(
  value: string | undefined,
): TeamSelection | null {
  if (!value) return null
  const sep = value.indexOf(":")
  if (sep <= 0 || sep === value.length - 1) return null
  return { region: value.slice(0, sep), teamId: value.slice(sep + 1) }
}

export function serializeTeamSelection(selection: TeamSelection): string {
  return `${selection.region}:${selection.teamId}`
}

/** Stores the selection; callable only from a server action or route handler. */
export async function writeTeamSelection(
  selection: TeamSelection,
): Promise<void> {
  const store = await cookies()
  store.set(ACTIVE_TEAM_COOKIE, serializeTeamSelection(selection), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  })
}

/** The stored selection for this request, or null when none was ever set. */
export async function readTeamSelection(): Promise<TeamSelection | null> {
  const store = await cookies()
  return parseTeamSelection(store.get(ACTIVE_TEAM_COOKIE)?.value)
}

/**
 * The cookie is settled at sign-in and wins when it matches a live membership.
 * The fallback must be deterministic across surfaces and
 * server instances (they resolve the team independently): regions keep their
 * incoming (cell) order via a first-appearance rank, and within a region the
 * team id pins the order. Ranking rather than a conditional comparator keeps
 * the sort a strict weak ordering — returning 0 across regions while
 * comparing ids within one is not transitive, and engines may order such
 * comparators arbitrarily.
 */
export function pickActiveTeam(
  memberships: TeamMembership[],
  selection: TeamSelection | null,
): TeamMembership | null {
  if (selection) {
    const match = memberships.find(
      (m) => m.teamId === selection.teamId && m.region === selection.region,
    )
    if (match) return match
  }
  const regionRank = new Map<string, number>()
  for (const m of memberships) {
    if (!regionRank.has(m.region)) regionRank.set(m.region, regionRank.size)
  }
  const ordered = memberships.toSorted(
    (a, b) =>
      (regionRank.get(a.region) as number) -
        (regionRank.get(b.region) as number) ||
      a.teamId.localeCompare(b.teamId),
  )
  return ordered[0] ?? null
}

export async function resolveActiveTeam(
  userId: string,
): Promise<TeamMembership | null> {
  const [rawMemberships, selection] = await Promise.all([
    listTeamMembershipsForUser(userId),
    readTeamSelection(),
  ])
  const { memberships } = await completedMemberships(userId, {
    memberships: rawMemberships,
    degradedRegions: [],
  })
  return pickActiveTeam(memberships, selection)
}

// The team the user last switched to, saved on the account so a new browser
// can open it too. Like the cookie, it is only a preference.
export function savedTeamSelection(user: {
  user_metadata?: Record<string, unknown>
}): TeamSelection | null {
  const value = user.user_metadata?.[ACTIVE_TEAM_METADATA_KEY]
  return parseTeamSelection(typeof value === "string" ? value : undefined)
}

// Oldest team first. Teams with an unknown creation date go last.
export function orderTeamsOldestFirst(
  memberships: TeamMembership[],
  createdAt: ReadonlyMap<string, string>,
): TeamMembership[] {
  const timestamp = (team: TeamMembership) => {
    const value = Date.parse(createdAt.get(serializeTeamSelection(team)) ?? "")
    return Number.isFinite(value) ? value : Infinity
  }
  return memberships.toSorted(
    (a, b) =>
      timestamp(a) - timestamp(b) ||
      a.region.localeCompare(b.region) ||
      a.teamId.localeCompare(b.teamId),
  )
}
