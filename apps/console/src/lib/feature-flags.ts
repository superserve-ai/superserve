const TRUE_VALUES = new Set(["1", "true", "yes", "on"])

function enabled(value: string | undefined): boolean {
  return TRUE_VALUES.has((value ?? "").trim().toLowerCase())
}

export function isTeamManagementEnabled(): boolean {
  return enabled(process.env.NEXT_PUBLIC_ENABLE_TEAM_MANAGEMENT)
}

export function isTeamManagementServerEnabled(): boolean {
  return (
    isTeamManagementEnabled() || enabled(process.env.ENABLE_TEAM_MANAGEMENT)
  )
}
