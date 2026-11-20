"use client"

import type {
  TeamManagementResponse,
  TeamScope,
} from "@/lib/api/team-management"

export const fixtureTeam = { teamId: "example-team", region: "use" }
export const fixtureRoles = [
  "team_admin",
  "user_admin",
  "billing_admin",
  "viewer",
  "team_owner",
]
export const TEAM_CHANGED_MESSAGE =
  "Your active team changed. Reload the page and try again."
export function sameTeam(left: TeamScope | null, right: TeamScope | null) {
  return left?.teamId === right?.teamId && left?.region === right?.region
}
export function useDisplayedTeam() {
  return fixtureTeam
}
export function useLeaveScope() {
  return fixtureTeam
}
export function useTeamName(scope: TeamScope | null) {
  return scope ? "Example Team" : undefined
}
const timestamp = "2026-11-07T12:00:00Z"
const management: TeamManagementResponse = {
  team_id: fixtureTeam.teamId,
  region: fixtureTeam.region,
  members: [
    {
      user_id: "you",
      email: "alex@example.com",
      full_name: "Alex Morgan",
      status: "active",
      roles: ["team_owner"],
      created_at: timestamp,
      updated_at: timestamp,
    },
    {
      user_id: "admin",
      email: "sam@example.com",
      full_name: "Sam Rivera",
      status: "active",
      roles: ["team_admin"],
      created_at: timestamp,
      updated_at: timestamp,
    },
    {
      user_id: "viewer",
      email: "jordan@example.com",
      full_name: "Jordan Lee",
      status: "active",
      roles: ["viewer"],
      created_at: timestamp,
      updated_at: timestamp,
    },
    {
      user_id: "removed",
      email: "casey@example.com",
      full_name: "Casey Taylor",
      status: "inactive",
      roles: [],
      created_at: timestamp,
      updated_at: timestamp,
    },
  ],
  assignments: [],
  capabilities: {
    can_view_role_assignments: false,
    can_assign_roles: true,
    can_revoke_roles: false,
    can_deactivate_members: true,
    can_invite_members: true,
    can_invite_owners: true,
    invitable_roles: fixtureRoles,
  },
}
export function useTeamManagement() {
  return {
    data: management,
    isPending: false,
    error: null,
    refetch: async () => {},
  }
}
export function useTeamInvitations() {
  return {
    data: {
      invitations: [
        {
          id: "one",
          email: "taylor@example.com",
          role: "viewer",
          status: "pending",
          delivery_status: "sent",
          created_at: timestamp,
          expires_at: "2026-11-14T12:00:00Z",
        },
        {
          id: "two",
          email: "morgan@example.com",
          role: "billing_admin",
          status: "pending",
          delivery_status: "failed",
          created_at: timestamp,
          expires_at: "2026-11-14T12:00:00Z",
        },
      ],
    },
    isPending: false,
    error: null,
    refetch: async () => {},
  }
}
export function useTeams() {
  return {
    data: {
      teams: [
        {
          id: fixtureTeam.teamId,
          region: fixtureTeam.region,
          name: "Example Team",
        },
        { id: "other-team", region: fixtureTeam.region, name: "Other Team" },
      ],
    },
  }
}
export function useUser() {
  return { user: { id: "you", app_metadata: {} } }
}
const mutation = () => ({
  mutate: () => {},
  mutateAsync: async () => {},
  reset: () => {},
  isPending: false,
})
export const useAssignTeamRole = mutation
export const useChangeTeamRole = mutation
export const useRevokeTeamRole = mutation
export const useRemoveTeamMember = mutation
export const useResendInvitation = mutation
export const useRevokeInvitation = mutation
export const useLeaveTeam = mutation
export function useCreateInvitation() {
  return {
    ...mutation(),
    refreshInvitations: async () => {},
    mutateAsync: async ({
      email,
    }: {
      team: TeamScope
      email: string
      role?: string
    }) => {
      if (email === "member@example.com") throw { code: "already_member" }
      if (email === "invited@example.com") throw { code: "invitation_pending" }
      return {
        ok: true,
        delivery: email === "delivery@example.com" ? "failed" : "sent",
      }
    },
  }
}
