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
    // stores the cookie.
    onMutate: async ({ teamId, region }) => {
      await queryClient.cancelQueries({ queryKey: teamKeys.directory() })
      queryClient.setQueryData<TeamDirectoryResponse>(
        teamKeys.directory(),
        (old) =>
          old ? { ...old, activeTeamId: teamId, activeRegion: region } : old,
      )
    },
    onError: async () => {
      // Not rolled back to a pre-mutate snapshot: the scope only serialises
      // `mutationFn` calls, so a team creation queued behind this switch can
      // have committed its own selection to the cookie between when the
      // snapshot was taken and when this switch failed. Restoring it would
      // put the client back on a selection the server no longer holds.
      // Refetching instead names whichever team the cookie actually holds.
      //
      // Awaited, not fire-and-forget: `teamKeys.switching()` is how the QM
      // hooks tell a switch is still in flight, so the mutation has to stay
      // pending until the directory is reconciled — otherwise a read or
      // write could land while the cache still names the rejected team.
      await queryClient.invalidateQueries({ queryKey: teamKeys.directory() })
      if (queryClient.getQueryState(teamKeys.directory())?.status === "error") {
        // A failed fetch leaves the last-known data in place, which here is
        // the rejected optimistic selection. Reset instead of trusting it:
        // that drops the stale team and retries for anything still watching.
        await queryClient.resetQueries({ queryKey: teamKeys.directory() })
      }
    },
    onSuccess: (_data, { teamId, region }) => {
      // Reassert the selection now that the cookie is definitely this team's.
      // The scope serialises the requests but not `onMutate`, so a team
      // creation settling in between can have overwritten the optimistic
      // selection with its own; whichever request ran last should be the one
      // the directory names.
      queryClient.setQueryData<TeamDirectoryResponse>(
        teamKeys.directory(),
        (old) =>
          old ? { ...old, activeTeamId: teamId, activeRegion: region } : old,
      )
      // No router.refresh(): the dashboard shell is a pure client layout, so
      // a refresh would only re-render RSC payloads that carry no team data —
      // and it invalidates the router cache, re-fetching every prefetched
      // route alongside the query refetches.
      refreshTeamScopedQueries(queryClient)
    },
  })
}
