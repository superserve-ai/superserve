"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { useUser } from "@/hooks/use-user"
import { ApiError } from "@/lib/api/client"
import { billingKeys, teamKeys } from "@/lib/api/query-keys"
import { renameTeamAction } from "@/lib/api/team-rename-actions"
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

// A team creation the user started. A conversion also records the account
// team and its region.
interface CreationIntent {
  operationId: string
  name: string
  nameRejected?: boolean
  region?: string
  convertTeamId?: string
}

const creationKeyPrefix = (userId: string) =>
  `superserve:team-creation:${userId}:`
const conversionKey = (userId: string) => `superserve:team-conversion:${userId}`

function readIntent(key: string): CreationIntent | null {
  const stored = sessionStorage.getItem(key)
  return stored ? JSON.parse(stored) : null
}

// Chooses the stored intent a request continues. An unresolved creation may
// already have committed, so it finishes first even when the form changed
// mode: a conversion in its own region (the form stops offering it once the
// rename commits), or a new team before a conversion starts. A rejected name
// releases its intent.
function pickIntentKey(
  userId: string,
  region: string,
  convertTeamId: string | undefined,
): { key: string; region: string } {
  const conversion = conversionKey(userId)
  const pendingConversion = readIntent(conversion)
  if (pendingConversion && !pendingConversion.nameRejected)
    return { key: conversion, region: pendingConversion.region ?? region }
  if (convertTeamId) {
    const prefix = creationKeyPrefix(userId)
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i)
      if (key?.startsWith(prefix) && !readIntent(key)?.nameRejected)
        return { key, region: key.slice(prefix.length) }
    }
    return { key: conversion, region }
  }
  if (pendingConversion) sessionStorage.removeItem(conversion)
  return { key: creationKeyPrefix(userId) + region, region }
}

export function useCreateTeam() {
  const { user } = useUser()
  const queryClient = useQueryClient()
  return useMutation({
    // Creation also changes the active-team cookie; share billing's switch guard.
    mutationKey: ["switch-team", "create"],
    mutationFn: async ({
      name,
      region,
      convertTeamId,
    }: {
      name: string
      region: string
      // The user's own account team, when the form converts it.
      convertTeamId?: string
    }) => {
      if (!user) throw new Error("Not authenticated")
      if (!name.trim() || new TextEncoder().encode(name).length > 256)
        throw new Error("Enter a team name between 1 and 256 bytes")
      const { key, region: targetRegion } = pickIntentKey(
        user.id,
        region,
        convertTeamId,
      )
      const stored = readIntent(key)
      const fresh = (): CreationIntent => ({
        operationId: crypto.randomUUID(),
        name,
        ...(key === conversionKey(user.id)
          ? { region: targetRegion, convertTeamId }
          : {}),
      })
      let intent = stored ?? fresh()
      // A rejected name no longer binds the request to its name or target.
      if (
        intent.nameRejected &&
        (intent.name !== name ||
          intent.convertTeamId !== convertTeamId ||
          (intent.convertTeamId && intent.region !== targetRegion))
      )
        intent = fresh()
      if (intent.name !== name)
        throw new Error(
          "Retry the pending team creation using its original name",
        )
      // This attempt can commit even if its response is lost, so only its own
      // conflict marks the name rejected again.
      delete intent.nameRejected
      sessionStorage.setItem(key, JSON.stringify(intent))
      const result = await (intent.convertTeamId
        ? createTeamAction(
            intent.name,
            intent.region ?? targetRegion,
            intent.operationId,
            intent.convertTeamId,
          )
        : createTeamAction(intent.name, targetRegion, intent.operationId))
      if ("code" in result) {
        if (result.code === "team_name_conflict") {
          intent.nameRejected = true
          sessionStorage.setItem(key, JSON.stringify(intent))
        }
        // The account can no longer be converted; let the reloaded form start
        // over.
        if (result.code === "team_conversion_unavailable")
          sessionStorage.removeItem(key)
        throw new ApiError(403, result.code, result.message)
      }
      sessionStorage.removeItem(key)
      // A retry may finish a conversion the form no longer offers.
      return { team: result, converted: Boolean(intent.convertTeamId) }
    },
    onSuccess: async ({ team }) => {
      // Cancel any directory read that started before the cookie changed.
      await queryClient.cancelQueries({ queryKey: teamKeys.directory() })
      queryClient.setQueryData<TeamDirectoryResponse>(
        teamKeys.directory(),
        (old) => ({
          // A converted account keeps its place under its new name.
          teams: (old?.teams ?? []).some(
            (item) => item.id === team.id && item.region === team.region,
          )
            ? (old?.teams ?? []).map((item) =>
                item.id === team.id && item.region === team.region
                  ? team
                  : item,
              )
            : [...(old?.teams ?? []), team],
          regions: old?.regions ?? [team.region],
          activeTeamId: team.id,
          activeRegion: team.region,
          // Account teams stay convertible unless this creation converted one.
          convertibleTeams: (old?.convertibleTeams ?? []).filter(
            (item) => !(item.id === team.id && item.region === team.region),
          ),
        }),
      )
      // Clear the previous team's data as soon as the selection changes.
      refreshTeamScopedQueries(queryClient)
      // Keep billing guarded through reconciliation. The returned selection
      // remains correct even if the directory refresh fails.
      await queryClient.invalidateQueries({ queryKey: teamKeys.directory() })
    },
  })
}

export function useRenameTeam() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      team,
      name,
    }: {
      team: { id: string; region: string }
      name: string
    }) => {
      const result = await renameTeamAction(
        { teamId: team.id, region: team.region },
        name,
      )
      if (!result.ok) throw new Error(result.message)
      return result.team
    },
    onSuccess: async (team) => {
      // Update the label in place so the sidebar switcher changes at once,
      // then reconcile with the server's directory.
      queryClient.setQueryData<TeamDirectoryResponse>(
        teamKeys.directory(),
        (old) =>
          old && {
            ...old,
            teams: old.teams.map((item) =>
              item.id === team.id && item.region === team.region
                ? { ...item, name: team.name }
                : item,
            ),
          },
      )
      await queryClient.invalidateQueries({ queryKey: teamKeys.directory() })
    },
  })
}

export function useSwitchTeam() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ["switch-team"],
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
