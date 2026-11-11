import { apiClient, apiClientWithHeaders } from "./client"

export type TeamMemberStatus = "active" | "inactive" | "invited"

export interface TeamManagementCapabilities {
  can_view_role_assignments: boolean
  can_invite_members: boolean
  can_deactivate_members: boolean
  can_assign_roles: boolean
  can_revoke_roles: boolean
  // Newer backends only; absent means the action is not offered.
  invitable_roles?: string[]
  can_invite_owners?: boolean
  invite_blocked_reason?: "free_plan" | null
  can_rename_team?: boolean
}

export type TeamInvitationStatus =
  | "pending"
  | "accepted"
  | "revoked"
  | "expired"

export type TeamInvitationDelivery = "pending" | "sent" | "failed"

export interface TeamInvitation {
  role?: string
  id: string
  email: string
  status: TeamInvitationStatus
  invited_by?: string | null
  created_at: string
  expires_at: string
  last_sent_at?: string | null
  delivery_status: TeamInvitationDelivery
}

export interface TeamInvitationsResponse {
  invitations: TeamInvitation[]
}

export interface TeamMember {
  user_id: string
  email: string
  full_name?: string | null
  status: TeamMemberStatus
  roles?: string[]
  created_at: string
  updated_at: string
}

export interface TeamRoleAssignment {
  assignment_id: string
  user_id: string
  email: string
  role_name: string
  scope_type: "team"
  team_id: string
  granted_by?: string | null
  granted_at: string
  revoked_at?: string | null
  created_at: string
  updated_at: string
}

export interface TeamManagementMutationOptions {
  member_statuses?: Array<"active" | "invited">
  assignable_roles?: string[]
}

export interface TeamManagementResponse {
  team_id: string
  region: string | null
  members: TeamMember[]
  assignments: TeamRoleAssignment[]
  capabilities: TeamManagementCapabilities
  mutation_options?: TeamManagementMutationOptions
}

export interface AddTeamMemberRequest {
  user_id: string
  status?: "active" | "invited"
}

export interface AssignTeamRoleRequest {
  user_id: string
  role_name: string
}

export async function getTeamManagement(): Promise<TeamManagementResponse> {
  const { data, headers } =
    await apiClientWithHeaders<Omit<TeamManagementResponse, "region">>(
      "/team-management",
    )
  const scope = headers
    .get("X-Superserve-Team-Scope")
    ?.match(/^([^:]+):([^:]+)$/)
  return {
    ...data,
    region: scope && scope[2] === data.team_id ? scope[1] : null,
  }
}

export async function getTeamInvitations(): Promise<TeamInvitationsResponse> {
  return apiClient<TeamInvitationsResponse>("/team-management/invitations")
}

export async function addTeamMember(data: AddTeamMemberRequest): Promise<void> {
  await apiClient<void>("/team-management/members", {
    method: "POST",
    body: JSON.stringify(data),
  })
}

/**
 * The active team is a cookie another tab can move, so every mutation names
 * the team the page was showing and the proxy refuses a mismatch.
 */
export interface TeamScope {
  teamId: string
  region: string
}

function scopeHeaders(scope: TeamScope): HeadersInit {
  return { "X-Superserve-Team-Scope": `${scope.region}:${scope.teamId}` }
}

export async function deactivateTeamMember(
  scope: TeamScope,
  userId: string,
): Promise<void> {
  await apiClient<void>(
    `/team-management/members/${encodeURIComponent(userId)}`,
    {
      method: "DELETE",
      headers: scopeHeaders(scope),
    },
  )
}

export async function assignTeamRole(
  scope: TeamScope,
  data: AssignTeamRoleRequest,
): Promise<void> {
  await apiClient<void>("/team-management/roles", {
    method: "POST",
    headers: scopeHeaders(scope),
    body: JSON.stringify(data),
  })
}

export async function revokeTeamRole(
  scope: TeamScope,
  assignmentId: string,
): Promise<void> {
  await apiClient<void>(
    `/team-management/roles/${encodeURIComponent(assignmentId)}`,
    {
      method: "DELETE",
      headers: scopeHeaders(scope),
    },
  )
}
