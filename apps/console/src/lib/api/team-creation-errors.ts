import { ApiError } from "@/lib/api/client"

export const TEAM_CREATION_NAME_LENGTH_MESSAGE =
  "Enter a team name between 1 and 256 bytes"
export const TEAM_CREATION_PENDING_MESSAGE =
  "Retry the pending team creation using its original name"

export function isCuratedTeamCreationError(error: unknown): error is Error {
  if (error instanceof ApiError) {
    return [
      "team_name_conflict",
      "team_conversion_unavailable",
      "signup_blocked",
      "invalid_team_name",
      "region_unavailable",
      "account_team_unconfirmed",
    ].includes(error.code)
  }
  return (
    error instanceof Error &&
    [TEAM_CREATION_NAME_LENGTH_MESSAGE, TEAM_CREATION_PENDING_MESSAGE].includes(
      error.message,
    )
  )
}
