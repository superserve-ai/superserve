"use client"

import { useToast } from "@superserve/ui"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { refreshTeamScopedQueries } from "@/hooks/use-teams"
import { ApiError } from "@/lib/api/client"
import { teamKeys } from "@/lib/api/query-keys"
import {
  createInvitationAction,
  leaveTeamAction,
  resendInvitationAction,
  revokeInvitationAction,
  type SendInvitationResult,
} from "@/lib/api/team-invitations-actions"
import {
  assignTeamRole,
  deactivateTeamMember,
  getTeamInvitations,
  getTeamManagement,
  revokeTeamRole,
  type AssignTeamRoleRequest,
} from "@/lib/api/team-management"

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

function friendlyRbacMessage(error: unknown, fallback: string): string {
  if (!(error instanceof ApiError)) {
    return fallback
  }

  if (error.status === 403) {
    return "You do not have permission to perform this team-management action."
  }
  if (error.status === 404) {
    return "That member, role assignment, or team could not be found. Refresh and try again."
  }
  if (error.status === 409) {
    return "This change conflicts with the current team state. If you are changing owners, make sure at least one active owner remains."
  }

  return error.message
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
    mutationFn: (data: AssignTeamRoleRequest) => assignTeamRole(data),
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
    mutationFn: (assignmentId: string) => revokeTeamRole(assignmentId),
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
    mutationFn: async (email: string) =>
      unwrap<Extract<SendInvitationResult, { ok: true }>>(
        await createInvitationAction(email),
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
    mutationFn: async (invitationId: string) =>
      unwrap<Extract<SendInvitationResult, { ok: true }>>(
        await resendInvitationAction(invitationId),
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
      addToast(error.message, "error")
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
    mutationFn: async (invitationId: string) =>
      unwrap(await revokeInvitationAction(invitationId)),
    onSuccess: () => {
      addToast("Invitation revoked", "success")
    },
    onError: (error) => {
      addToast(error.message, "error")
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
    mutationFn: (userId: string) => deactivateTeamMember(userId),
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
    mutationFn: async () => unwrap(await leaveTeamAction()),
    onSuccess: async () => {
      refreshTeamScopedQueries(queryClient)
      await queryClient.invalidateQueries({ queryKey: teamKeys.directory() })
    },
  })
}
