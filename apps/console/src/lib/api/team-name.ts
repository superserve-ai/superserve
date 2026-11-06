export const TEAM_NAME_MAX_LENGTH = 64

export const TEAM_NAME_UNAVAILABLE_MESSAGE =
  "That name is unavailable. Try another."

export const TEAM_NAME_LENGTH_MESSAGE = `Enter a team name between 1 and ${TEAM_NAME_MAX_LENGTH} characters.`

// Mirrors the backend rule: 1..64 characters after trimming, no control
// characters. The backend stays the authority; this only saves a round trip.
export function teamNameProblem(trimmedName: string): string | null {
  const length = [...trimmedName].length
  if (length < 1 || length > TEAM_NAME_MAX_LENGTH) {
    return TEAM_NAME_LENGTH_MESSAGE
  }
  // oxlint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f-\u009f]/.test(trimmedName)) {
    return "Team names cannot contain control characters."
  }
  return null
}
