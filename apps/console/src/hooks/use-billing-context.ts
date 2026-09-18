"use client"

import { useIsMutating } from "@tanstack/react-query"

import {
  useDashboardTeamContext,
  useQueryScope,
} from "@/components/query-provider"

import { useTeams } from "./use-teams"

export interface BillingQueryContext {
  cacheScope: string
  teamKey: string | null
  ready: boolean
}

export function useBillingContext(): BillingQueryContext {
  const cacheScope = useQueryScope()
  const impersonatedTeam = useDashboardTeamContext()
  const switching = useIsMutating({ mutationKey: ["switch-team"] }) > 0
  const { data: teams } = useTeams()
  const teamKey = impersonatedTeam
    ? `${impersonatedTeam.region}:${impersonatedTeam.teamId}`
    : teams?.activeTeamId && teams.activeRegion
      ? `${teams.activeRegion}:${teams.activeTeamId}`
      : null

  return {
    cacheScope,
    teamKey,
    ready: teamKey !== null && !switching,
  }
}
