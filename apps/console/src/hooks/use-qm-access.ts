"use client"

import { useDashboardTeamContext } from "@/components/query-provider"
import { useTeams } from "@/hooks/use-teams"
import { canAccessQm, qmBetaAllowlist } from "@/lib/qm/access"

export interface QmAccess {
  /** True once we know the active team is in the beta. */
  enabled: boolean
  /** True while the team directory needed to decide is still loading. */
  loading: boolean
}

/**
 * Whether the QM section should exist for the current viewer: the active
 * team (the impersonated team while viewing another team) must be on the
 * beta allowlist. Resolves without waiting for the team directory when the
 * answer doesn't depend on it.
 */
export function useQmAccess(): QmAccess {
  const teamContext = useDashboardTeamContext()
  const allowlist = qmBetaAllowlist()
  const needsTeam =
    !allowlist.everyone && allowlist.teamIds.size > 0 && !teamContext
  const teams = useTeams()

  const teamId = teamContext?.teamId ?? teams.data?.activeTeamId ?? null
  const enabled = canAccessQm(teamId, allowlist)
  const loading = !enabled && needsTeam && teams.isPending && !teams.error

  return { enabled, loading }
}
