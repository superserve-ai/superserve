"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { billingKeys, teamKeys } from "@/lib/api/query-keys"
import {
  createTeamAction,
  listTeamsAction,
  setActiveTeamAction,
  type TeamDirectoryResponse,
} from "@/lib/api/teams-actions"

export function useTeams() {
  return useQuery({
    queryKey: teamKeys.directory(),
    queryFn: listTeamsAction,
    staleTime: 5 * 60_000,
  })
}

/**
 * Drop every cached dataset that belongs to the previous team. Reset (not
 * invalidate) so stale rows can never flash while the new team's data loads;
 * active queries refetch immediately, inactive ones on next mount. The team
 * directory is exempt — it is team-agnostic and already carries the new
 * selection.
 */
function resetTeamScopedQueries(
  queryClient: ReturnType<typeof useQueryClient>,
) {
  void queryClient.resetQueries({
    predicate: (query) => query.queryKey[0] !== teamKeys.all[0],
  })
}

function invalidateBillingSummary(
  queryClient: ReturnType<typeof useQueryClient>,
) {
  void queryClient.invalidateQueries({ queryKey: billingKeys.all })
}

export function refreshTeamScopedQueries(
  queryClient: ReturnType<typeof useQueryClient>,
) {
  invalidateBillingSummary(queryClient)
  resetTeamScopedQueries(queryClient)
}

/**
 * Everything that changes the active team runs in this scope, so React Query
 * serialises it. Creating a team and switching teams both write the same
 * cookie and the same cached selection; interleaving them leaves the client
 * naming one team while requests authenticate as another, and no amount of
 * patching after the fact can recover an order that was never defined.
 */
const TEAM_SELECTION_SCOPE = { id: "team-selection" } as const

export function useCreateTeam() {
  const queryClient = useQueryClient()
  return useMutation({
    // Creating a team also switches to it, so it carries the same key as an
    // explicit switch and team-scoped hooks hold off for both.
    mutationKey: teamKeys.switching(),
    scope: TEAM_SELECTION_SCOPE,
    mutationFn: async ({ name, region }: { name: string; region: string }) => {
      const team = await createTeamAction(name, region)
      // Reconcile the directory here, inside the mutation, so the switch
      // stays pending until the client's active team matches the cookie the
      // server now holds. The patch is what guarantees they agree: the
      // refetch that follows fills in the new row but swallows its own
      // failure, and a degraded regional read can come back a successful but
      // partial directory that names the previous team — so the patch is
      // applied on both sides of it.
      const selectCreated = (old: TeamDirectoryResponse | undefined) =>
        old
          ? {
              ...old,
              teams: old.teams.some((t) => t.id === team.id)
                ? old.teams
                : [...old.teams, team],
              activeTeamId: team.id,
              activeRegion: team.region,
            }
          : old
      queryClient.setQueryData<TeamDirectoryResponse>(
        teamKeys.directory(),
        selectCreated,
      )
      await queryClient.refetchQueries({ queryKey: teamKeys.directory() })
      queryClient.setQueryData<TeamDirectoryResponse>(
        teamKeys.directory(),
        selectCreated,
      )
      return team
    },
    onSuccess: () => {
      refreshTeamScopedQueries(queryClient)
    },
  })
}

export function useSwitchTeam() {
  const queryClient = useQueryClient()
  return useMutation({
    // Named so team-scoped hooks can hold off while the switch is in flight.
    mutationKey: teamKeys.switching(),
    scope: TEAM_SELECTION_SCOPE,
    mutationFn: ({ teamId, region }: { teamId: string; region: string }) =>
      setActiveTeamAction(teamId, region),
    // Flip the switcher immediately; the server action only validates and
    // stores the cookie. Rolled back on error.
    onMutate: async ({ teamId, region }) => {
      await queryClient.cancelQueries({ queryKey: teamKeys.directory() })
      const previous = queryClient.getQueryData<TeamDirectoryResponse>(
        teamKeys.directory(),
      )
      queryClient.setQueryData<TeamDirectoryResponse>(
        teamKeys.directory(),
        (old) =>
          old ? { ...old, activeTeamId: teamId, activeRegion: region } : old,
      )
      return { previous }
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(teamKeys.directory(), context.previous)
      }
    },
    onSuccess: () => {
      // No router.refresh(): the dashboard shell is a pure client layout, so
      // a refresh would only re-render RSC payloads that carry no team data —
      // and it invalidates the router cache, re-fetching every prefetched
      // route alongside the query refetches.
      refreshTeamScopedQueries(queryClient)
    },
  })
}
