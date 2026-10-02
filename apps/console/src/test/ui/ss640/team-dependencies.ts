"use client"

import type {
  TeamDirectoryResponse,
  TeamSummary,
} from "../../../lib/api/teams-actions"

// Substitute only the service boundary. The real query/mutation hooks still
// reconcile the directory, pending state, selection, and toast callbacks.
let state:
  | {
      caseId: string
      attempts: number
      committed?: TeamSummary
      directory: TeamDirectoryResponse
    }
  | undefined

function current() {
  const caseId =
    new URLSearchParams(window.location.search).get("ui_case") ?? ""
  if (!state || state.caseId !== caseId) {
    state = {
      caseId,
      attempts: 0,
      directory: {
        teams: [
          { id: "east-fixture", name: "East fixture team", region: "use" },
        ],
        regions: ["use", "usw"],
        activeTeamId: "east-fixture",
        activeRegion: "use",
      },
    }
  }
  return state
}

export async function listTeamsAction(): Promise<TeamDirectoryResponse> {
  return structuredClone(current().directory)
}

export async function createTeamAction(name: string, region = "use") {
  const fixture = current()
  if (region !== "usw" || !name.trim())
    throw new Error("Invalid synthetic team request")
  fixture.attempts += 1
  if (fixture.caseId === "ss640-west-loading") {
    return new Promise<TeamSummary>(() => {})
  }
  fixture.committed ??= { id: "west-fixture", name: name.trim(), region }
  if (fixture.caseId.includes("uncertain") && fixture.attempts === 1) {
    // The simulated service has committed, but the client hasn't received it.
    // A subsequent call returns that same result, not a second team.
    throw new Error("Something went wrong. Please try again.")
  }
  const team = fixture.committed
  fixture.directory = {
    ...fixture.directory,
    teams: [fixture.directory.teams[0], team],
    activeTeamId: team.id,
    activeRegion: team.region,
  }
  return { ...team }
}

export async function setActiveTeamAction(teamId: string, region: string) {
  const fixture = current()
  if (
    !fixture.directory.teams.some(
      (team) => team.id === teamId && team.region === region,
    )
  ) {
    throw new Error("Unknown synthetic team")
  }
  fixture.directory = {
    ...fixture.directory,
    activeTeamId: teamId,
    activeRegion: region,
  }
}
