"use client"

import { useDashboardTeamContext } from "@/components/query-provider"
import { useTeams } from "@/hooks/use-teams"
import { useUser } from "@/hooks/use-user"
import { canAccessQm, qmBetaAllowlist } from "@/lib/qm/access"

export interface QmAccess {
  /** True once we know the active team (or user) is in the beta. */
  enabled: boolean
  /** True while the inputs needed to decide are still loading. */
  loading: boolean
}

/**
 * Whether the QM section should exist for the current viewer. Staff always
 * pass; otherwise the active team (the impersonated team while viewing
 * another team) must be on the beta allowlist. Resolves without waiting for
 * the team directory when the answer doesn't depend on it.
 */
export function useQmAccess(): QmAccess {
  const { user, loading: userLoading } = useUser()
  const teamContext = useDashboardTeamContext()
  const allowlist = qmBetaAllowlist()
  const needsTeam =
    !allowlist.everyone && allowlist.teamIds.size > 0 && !teamContext
  const teams = useTeams()

  const teamId = teamContext?.teamId ?? teams.data?.activeTeamId ?? null
  const enabled = canAccessQm(user, teamId, allowlist)
  const loading =
    !enabled && (userLoading || (needsTeam && teams.isPending && !teams.error))

  return { enabled, loading }
}
