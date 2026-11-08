"use server"

import { getAuthApiKeyAndTeamForUser } from "@/lib/api/proxy-auth"
import { invalidateMembershipDirectory } from "@/lib/api/team-directory"
import {
  TEAM_NAME_LENGTH_MESSAGE,
  TEAM_NAME_UNAVAILABLE_MESSAGE,
  teamNameProblem,
} from "@/lib/api/team-name"
import { cellFor } from "@/lib/cells"
import { createServerClient } from "@/lib/supabase/server"

export type RenameTeamResult =
  | { ok: true; team: { id: string; name: string; region: string } }
  | {
      ok: false
      code:
        | "invalid_name"
        | "name_unavailable"
        | "forbidden"
        | "team_changed"
        | "failed"
      message: string
    }

function failure(
  code: Extract<RenameTeamResult, { ok: false }>["code"],
  message: string,
): RenameTeamResult {
  return { ok: false, code, message }
}

async function currentUser() {
  const {
    data: { user },
  } = await (await createServerClient()).auth.getUser()
  return user
}

/**
 * Rename the active team through the customer API with the user's own team
 * key, so the backend enforces `settings:write` and writes the audit trail.
 * `expected` pins the team the form was showing: a cookie switched in another
 * tab must never redirect the rename to a different team.
 */
export async function renameTeamAction(
  expected: { teamId: string; region: string },
  name: string,
): Promise<RenameTeamResult> {
  const user = await currentUser()
  if (!user) throw new Error("Not authenticated")

  const trimmed = name.trim()
  const problem = teamNameProblem(trimmed)
  if (problem) return failure("invalid_name", problem)

  let response: Response
  let team: { teamId: string; region: string }
  try {
    const resolved = await getAuthApiKeyAndTeamForUser(user)
    team = resolved.team
    if (team.teamId !== expected.teamId || team.region !== expected.region) {
      return failure(
        "team_changed",
        "Your active team changed. Reload the page and try again.",
      )
    }
    response = await fetch(
      new URL(
        `/teams/${encodeURIComponent(team.teamId)}`,
        cellFor(team.region).apiBaseUrl,
      ),
      {
        method: "PATCH",
        headers: {
          "X-API-Key": resolved.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: trimmed }),
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      },
    )
  } catch {
    return failure("failed", "Failed to rename team. Try again.")
  }

  if (response.status === 409) {
    return failure("name_unavailable", TEAM_NAME_UNAVAILABLE_MESSAGE)
  }
  if (response.status === 403) {
    return failure(
      "forbidden",
      "You do not have permission to rename this team.",
    )
  }
  if (response.status === 400) {
    return failure("invalid_name", TEAM_NAME_LENGTH_MESSAGE)
  }
  if (!response.ok) {
    return failure("failed", "Failed to rename team. Try again.")
  }

  // Team labels come from the membership directory cache; drop it so the
  // sidebar switcher and directory reads see the new name immediately.
  invalidateMembershipDirectory(user.id)

  const body = (await response.json().catch(() => null)) as {
    name?: unknown
  } | null
  return {
    ok: true,
    team: {
      id: team.teamId,
      name: typeof body?.name === "string" ? body.name : trimmed,
      region: team.region,
    },
  }
}
