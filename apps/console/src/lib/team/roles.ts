import type { TeamMember } from "@/lib/api/team-management"

export const TEAM_ROLES = {
  team_admin: {
    label: "Team admin",
    description:
      "Create sandboxes and API keys and manage settings. Can remove members who are not Owners or Team admins, but cannot invite or change roles.",
  },
  user_admin: {
    label: "User admin",
    description: "Manage members only. No sandbox access.",
  },
  billing_admin: {
    label: "Billing admin",
    description: "Manage billing only. No sandbox access.",
  },
  viewer: {
    label: "Viewer",
    description: "Read-only access to sandboxes and settings.",
  },
  team_owner: {
    label: "Owner",
    description: "Full access, including billing and roles.",
  },
} as const

export type TeamRole = keyof typeof TEAM_ROLES

export function knownTeamRole(role: string | undefined): TeamRole | undefined {
  return role && Object.hasOwn(TEAM_ROLES, role)
    ? (role as TeamRole)
    : undefined
}

export function roleLabel(role: string): string {
  const known = knownTeamRole(role)
  return known
    ? TEAM_ROLES[known].label
    : role
        .split("_")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ")
}

export function invitableRoles(allowed: string[]): TeamRole[] {
  return (Object.keys(TEAM_ROLES) as TeamRole[]).filter((role) =>
    allowed.includes(role),
  )
}

// Owner is never preselected: it must be chosen on purpose.
export function defaultInviteRole(allowed: TeamRole[]): TeamRole | undefined {
  return (
    ["team_admin", "viewer", "billing_admin", "user_admin"] as const
  ).find((role) => allowed.includes(role))
}

export const LEGACY_INVITE_NOTICE =
  "Invites join as Owner with full access to this team."
export const INVITE_UPGRADE_REASON = "Upgrade to invite members"

export const LAST_OWNER_REASON = "A team needs at least one owner."
export const LEAVE_LAST_OWNER_REASON =
  "Make another member an owner before leaving."

export function ownerRemovalBlocked(
  members: TeamMember[] | undefined,
  userId: string | undefined,
): boolean {
  if (!members) return true
  const member = members.find(
    (item) => item.user_id === userId && item.status === "active",
  )
  if (!member) return true
  if (!(member.roles ?? []).includes("team_owner")) return false
  const active = members.filter((item) => item.status === "active")
  return (
    active.filter((item) => (item.roles ?? []).includes("team_owner")).length <=
    1
  )
}
