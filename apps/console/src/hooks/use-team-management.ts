"use client"

import { useToast } from "@superserve/ui"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"

import { refreshTeamScopedQueries, useTeams } from "@/hooks/use-teams"
import { ApiError } from "@/lib/api/client"
import { teamKeys } from "@/lib/api/query-keys"
import {
  createInvitationAction,
  leaveTeamAction,
  resendInvitationAction,
  revokeInvitationAction,
  type LeaveTeamResult,
  type SendInvitationResult,
} from "@/lib/api/team-invitations-actions"
import {
  assignTeamRole,
  deactivateTeamMember,
  getTeamInvitations,
  getTeamManagement,
  revokeTeamRole,
  type AssignTeamRoleRequest,
  type TeamScope,
} from "@/lib/api/team-management"
import type { TeamDirectoryResponse } from "@/lib/api/teams-actions"

// Not team-scoped: switching teams resets every non-"teams" query, which
// includes these, so one team's members never show under another.
const teamManagementKeys = {
  all: ["team-management"] as const,
  invitations: () => [...teamManagementKeys.all, "invitations"] as const,
}

// Server actions return typed failures instead of throwing so their message
// survives the server boundary; surface it as a normal Error for mutations.
export class InvitationActionFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

function unwrap<T extends { ok: true }>(
  result: T | { ok: false; code: string; message: string },
): T {
  if (!result.ok) throw new InvitationActionFailure(result.code, result.message)
  return result
}

const TEAM_NOT_READY_MESSAGE =
  "Your active team is still loading. Try again in a moment."

/**
 * The team this page is showing: the one the loaded management data belongs
 * to, with its region from the management response. Null until the directory
 * agrees, so a mutation never targets a team the user is not looking at.
 */
export function useDisplayedTeam(): TeamScope | null {
  const queryClient = useQueryClient()
  const { data: management } = useTeamManagement()
  const { data: directory } = useTeams()
  const teamId = management?.team_id
  const scope: TeamScope | null =
    teamId &&
    management.region &&
    directory?.activeTeamId === teamId &&
    directory.activeRegion === management.region
      ? { teamId, region: management.region }
      : null
  // A switch in another tab reaches the management data on refocus while the
  // directory stays cached, which would leave every action disabled. Reload
  // both once per disagreement, and drop the other team-scoped caches as a
  // switch here does. Management is refetched, not reset: a reset empties it,
  // which clears and then restores a lasting disagreement and loops.
  const disagreement =
    management && directory && !scope
      ? [
          teamId,
          management.region,
          directory.activeTeamId,
          directory.activeRegion,
        ].join("|")
      : null
  useEffect(() => {
    if (!disagreement) return
    void queryClient.invalidateQueries({ queryKey: teamKeys.directory() })
    void queryClient.invalidateQueries({
      queryKey: teamManagementKeys.all,
      exact: true,
    })
    refreshTeamScopedQueries(queryClient, teamManagementKeys.all[0])
  }, [disagreement, queryClient])
  return scope
}

/**
 * The team a leave targets. Leaving needs no team-management permission, so
 * when the management read is refused the directory's active team stands in;
 * the server still rejects a scope that is not the session's active team.
 */
export function useLeaveScope(): TeamScope | null {
  const displayed = useDisplayedTeam()
  const { error } = useTeamManagement()
  const { data: directory } = useTeams()
  if (displayed) return displayed
  if (!(error instanceof ApiError) || error.status !== 403) return null
  return directory?.activeTeamId && directory.activeRegion
    ? { teamId: directory.activeTeamId, region: directory.activeRegion }
    : null
}

export const TEAM_CHANGED_MESSAGE =
  "Your active team changed. Reload the page and try again."

export function sameTeam(a: TeamScope | null, b: TeamScope | null): boolean {
  return !!a && !!b && a.teamId === b.teamId && a.region === b.region
}

function requireTeam(team: TeamScope | null): TeamScope {
  if (!team) throw new Error(TEAM_NOT_READY_MESSAGE)
  return team
}

function friendlyRbacMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message === TEAM_NOT_READY_MESSAGE) {
    return error.message
  }
  if (!(error instanceof ApiError)) {
    console.error("Team-management action failed:", error)
    return fallback
  }
  if (error.code === "team_changed") return error.message

  if (error.status === 403) {
    return "You do not have permission to perform this team-management action."
  }
  if (error.status === 404) {
    return "That member, role assignment, or team could not be found. Refresh and try again."
  }
  if (error.status === 409) {
    return "This change conflicts with the current team state. If you are changing owners, make sure at least one active owner remains."
  }

  console.error("Team-management action failed:", error)
  return fallback
}

function friendlyInvitationMessage(error: unknown, fallback: string): string {
  if (
    error instanceof InvitationActionFailure ||
    (error instanceof Error && error.message === TEAM_NOT_READY_MESSAGE)
  ) {
    return error.message
  }
  console.error("Invitation action failed:", error)
  return fallback
}

export function useTeamManagement() {
  return useQuery({
    queryKey: teamManagementKeys.all,
    queryFn: getTeamManagement,
  })
}

export function useAssignTeamRole() {
  const queryClient = useQueryClient()
  const { addToast } = useToast()

  return useMutation({
    mutationFn: ({
      team,
      data,
    }: {
      team: TeamScope | null
      data: AssignTeamRoleRequest
    }) => assignTeamRole(requireTeam(team), data),
    onSuccess: () => {
      addToast("Role assigned", "success")
    },
    onError: (error) => {
      addToast(friendlyRbacMessage(error, "Failed to assign role."), "error")
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: teamManagementKeys.all })
    },
  })
}

export function useRevokeTeamRole() {
  const queryClient = useQueryClient()
  const { addToast } = useToast()

  return useMutation({
    mutationFn: ({
      team,
      assignmentId,
    }: {
      team: TeamScope | null
      assignmentId: string
    }) => revokeTeamRole(requireTeam(team), assignmentId),
    onSuccess: () => {
      addToast("Role revoked", "success")
    },
    onError: (error) => {
      addToast(friendlyRbacMessage(error, "Failed to revoke role."), "error")
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: teamManagementKeys.all })
    },
  })
}

export function useTeamInvitations() {
  return useQuery({
    queryKey: teamManagementKeys.invitations(),
    queryFn: getTeamInvitations,
  })
}

export function useCreateInvitation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      team,
      email,
    }: {
      team: TeamScope | null
      email: string
    }) =>
      unwrap<Extract<SendInvitationResult, { ok: true }>>(
        await createInvitationAction(requireTeam(team), email),
      ),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: teamManagementKeys.all })
    },
  })
}

export function useResendInvitation() {
  const queryClient = useQueryClient()
  const { addToast } = useToast()

  return useMutation({
    mutationFn: async ({
      team,
      invitationId,
    }: {
      team: TeamScope | null
      invitationId: string
    }) =>
      unwrap<Extract<SendInvitationResult, { ok: true }>>(
        await resendInvitationAction(requireTeam(team), invitationId),
      ),
    onSuccess: (result) => {
      if (result.delivery === "sent") {
        addToast("Invitation email sent", "success")
      } else {
        addToast(
          "The invitation email could not be sent. Try resending it.",
          "error",
        )
      }
    },
    onError: (error) => {
      addToast(
        friendlyInvitationMessage(
          error,
          "Failed to resend invitation. Try again.",
        ),
        "error",
      )
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: teamManagementKeys.all })
    },
  })
}

export function useRevokeInvitation() {
  const queryClient = useQueryClient()
  const { addToast } = useToast()

  return useMutation({
    mutationFn: async ({
      team,
      invitationId,
    }: {
      team: TeamScope | null
      invitationId: string
    }) => unwrap(await revokeInvitationAction(requireTeam(team), invitationId)),
    onSuccess: () => {
      addToast("Invitation revoked", "success")
    },
    onError: (error) => {
      addToast(
        friendlyInvitationMessage(
          error,
          "Failed to revoke invitation. Try again.",
        ),
        "error",
      )
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: teamManagementKeys.all })
    },
  })
}

export function useRemoveTeamMember() {
  const queryClient = useQueryClient()
  const { addToast } = useToast()

  return useMutation({
    mutationFn: ({
      team,
      userId,
    }: {
      team: TeamScope | null
      userId: string
    }) => deactivateTeamMember(requireTeam(team), userId),
    onSuccess: () => {
      addToast("Member removed", "success")
    },
    onError: (error) => {
      addToast(friendlyRbacMessage(error, "Failed to remove member."), "error")
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: teamManagementKeys.all })
    },
  })
}

export function useLeaveTeam() {
  const queryClient = useQueryClient()

  return useMutation({
    // Leaving moves the active-team cookie, so share the switch-team guard.
    mutationKey: ["switch-team", "leave"],
    mutationFn: async ({ team }: { team: TeamScope | null }) =>
      unwrap<LeaveTeamResult>(await leaveTeamAction(requireTeam(team))),
    onSuccess: async ({ active }, { team }) => {
      // Show the new selection before the refresh, which may fail and would
      // otherwise keep the departed team active beside the new team's data.
      await queryClient.cancelQueries({ queryKey: teamKeys.directory() })
      queryClient.setQueryData<TeamDirectoryResponse>(
        teamKeys.directory(),
        (old) =>
          old && {
            ...old,
            teams: old.teams.filter(
              (item) =>
                item.id !== team?.teamId || item.region !== team?.region,
            ),
            activeTeamId: active?.teamId ?? null,
            activeRegion: active?.region ?? null,
          },
      )
      refreshTeamScopedQueries(queryClient)
      await queryClient.invalidateQueries({ queryKey: teamKeys.directory() })
    },
  })
}
