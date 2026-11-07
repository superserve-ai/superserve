"use client"

import { ShieldCheckIcon, UsersIcon } from "@phosphor-icons/react"
import {
  Button,
  ConfirmDialog,
  Field,
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useToast,
} from "@superserve/ui"
import { useEffect, useState } from "react"
import type { FormEvent } from "react"

import { EmptyState } from "@/components/empty-state"
import { ErrorState } from "@/components/error-state"
import { PageHeader } from "@/components/page-header"
import { useDashboardTeamContext } from "@/components/query-provider"
import { TableSkeleton } from "@/components/table-skeleton"
import {
  sameTeam,
  TEAM_CHANGED_MESSAGE,
  useChangeTeamRole,
  useDisplayedTeam,
  useLeaveScope,
  useRemoveTeamMember,
  useRevokeTeamRole,
  useTeamManagement,
  useTeamName,
} from "@/hooks/use-team-management"
import { useUser } from "@/hooks/use-user"
import { canViewOtherUsersAccount } from "@/lib/admin/permissions"
import { ApiError } from "@/lib/api/client"
import type {
  TeamMember,
  TeamRoleAssignment,
  TeamScope,
} from "@/lib/api/team-management"
import {
  LAST_OWNER_REASON,
  ownerRemovalBlocked,
  roleLabel,
} from "@/lib/team/roles"

import {
  InvitationsSection,
  InviteMemberCard,
  inviteControlState,
  LeaveTeamSection,
} from "./invitations-section"

function RolePills({ roles }: { roles?: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {roles?.map((role) => (
        <span
          key={role}
          className="border border-dashed border-border px-2 py-0.5 font-mono text-[11px] text-foreground/80 uppercase"
        >
          {roleLabel(role)}
        </span>
      ))}
    </div>
  )
}

function ChangeRoleForm({
  members,
  assignments,
  roles,
  selectedUserId,
  onSelectedUserIdChange,
}: {
  members: TeamMember[]
  assignments: TeamRoleAssignment[]
  roles: string[]
  selectedUserId: string
  onSelectedUserIdChange: (userId: string) => void
}) {
  const changeRole = useChangeTeamRole()
  const { addToast } = useToast()
  const team = useDisplayedTeam()
  const activeMembers = members.filter((member) => member.status === "active")
  const [roleName, setRoleName] = useState("")

  const selectedRoleName = roles.includes(roleName)
    ? roleName
    : (roles[0] ?? "")

  const selectedMember = activeMembers.find(
    (member) => member.user_id === selectedUserId,
  )
  const activeRoles = Array.from(
    new Set([
      ...(selectedMember?.roles ?? []),
      ...assignments
        .filter(
          (assignment) =>
            assignment.team_id === team?.teamId &&
            assignment.user_id === selectedUserId &&
            !assignment.revoked_at,
        )
        .map((assignment) => assignment.role_name),
    ]),
  )
  const unchanged =
    activeRoles.length === 1 && activeRoles[0] === selectedRoleName
  const ownerBlocked =
    selectedRoleName !== "team_owner" &&
    ownerRemovalBlocked(members, selectedUserId)
  const disabled =
    !team ||
    !selectedMember ||
    !selectedRoleName ||
    unchanged ||
    ownerBlocked ||
    changeRole.isPending
  const [confirming, setConfirming] = useState<{
    team: TeamScope
    userId: string
    email: string
    oldRoles: string[]
    roleName: string
  } | null>(null)

  useEffect(() => {
    if (confirming && !sameTeam(confirming.team, team)) setConfirming(null)
  }, [confirming, team])

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (disabled || !team || !selectedMember) return
    setConfirming({
      team,
      userId: selectedUserId,
      email: selectedMember.email,
      oldRoles: activeRoles,
      roleName: selectedRoleName,
    })
  }

  if (activeMembers.length === 0 || roles.length === 0) {
    return (
      <p className="text-sm text-muted">
        Add an active member before assigning team roles.
      </p>
    )
  }

  return (
    <>
      <form
        onSubmit={onSubmit}
        className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_220px_auto]"
      >
        <Field label="Select member" className="min-w-0">
          <div>
            <Select
              value={selectedUserId}
              onValueChange={(value) => onSelectedUserIdChange(value ?? "")}
            >
              <SelectTrigger className="h-9 min-w-0 gap-3 border-dashed border-border px-3">
                <SelectValue className="min-w-0 truncate">
                  {() =>
                    activeMembers.find(
                      (member) => member.user_id === selectedUserId,
                    )?.email
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectPopup
                dropdown
                className="max-w-[var(--available-width)] min-w-[var(--anchor-width)]"
              >
                {activeMembers.map((member) => (
                  <SelectItem
                    key={member.user_id}
                    value={member.user_id}
                    className="px-3 py-2 break-all"
                  >
                    {member.email}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>
        </Field>
        <Field label="New role" className="min-w-0">
          <div>
            <Select
              value={selectedRoleName}
              onValueChange={(value) => setRoleName(value ?? "")}
            >
              <SelectTrigger className="h-9 min-w-0 gap-3 border-dashed border-border px-3">
                <SelectValue className="truncate">
                  {() => roleLabel(selectedRoleName)}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup dropdown className="min-w-[var(--anchor-width)]">
                {roles.map((role) => (
                  <SelectItem key={role} value={role} className="px-3 py-2">
                    {roleLabel(role)}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>
        </Field>
        <div className="flex items-end">
          <Button
            type="submit"
            disabled={disabled}
            aria-describedby={
              ownerBlocked ? "change-role-owner-reason" : undefined
            }
          >
            <ShieldCheckIcon className="size-3.5" weight="light" />
            {changeRole.isPending ? "Changing..." : "Change role"}
          </Button>
        </div>
      </form>
      {ownerBlocked && (
        <p id="change-role-owner-reason" className="text-sm text-muted">
          {LAST_OWNER_REASON}
        </p>
      )}
      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null)
        }}
        title="Change role"
        description={`Change ${confirming?.email ?? "this member"} from ${confirming?.oldRoles.map(roleLabel).join(" + ") || "no role"} to ${confirming ? roleLabel(confirming.roleName) : "the new role"}?`}
        confirmLabel="Change role"
        onConfirm={async () => {
          if (!confirming) return
          if (!sameTeam(confirming.team, team)) {
            setConfirming(null)
            addToast(TEAM_CHANGED_MESSAGE, "error")
            return
          }
          if (
            confirming.roleName !== "team_owner" &&
            ownerRemovalBlocked(members, confirming.userId)
          ) {
            addToast(LAST_OWNER_REASON, "error")
            return
          }
          await changeRole
            .mutateAsync({
              team: confirming.team,
              data: {
                user_id: confirming.userId,
                role_name: confirming.roleName,
              },
              assignments,
            })
            .catch(() => {})
        }}
      />
    </>
  )
}

function MemberList({
  members,
  currentUserId,
  onRemove,
}: {
  members: TeamMember[]
  currentUserId?: string
  onRemove?: (member: TeamMember) => void
}) {
  return (
    <ul className="mt-4 divide-y divide-dashed divide-border border border-dashed border-border">
      {members.map((member) => (
        <li
          key={member.user_id}
          className="flex flex-wrap items-center gap-3 px-4 py-3"
        >
          <span className="flex size-8 shrink-0 items-center justify-center border border-dashed border-border bg-surface font-mono text-xs">
            {(member.full_name || member.email)
              .split(/[\s@._-]+/)
              .slice(0, 2)
              .map((part) => part[0])
              .join("")
              .toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-sm">
              <span className="min-w-0 break-all">
                {member.full_name || "Team member"}
              </span>
              {member.user_id === currentUserId && (
                <span className="shrink-0 border border-dashed border-brand/30 px-1.5 font-mono text-[11px] text-brand uppercase">
                  You
                </span>
              )}
              {member.status === "invited" && (
                <span className="shrink-0 font-mono text-[11px] text-muted uppercase">
                  Invited
                </span>
              )}
            </div>
            <span data-mask className="text-sm break-all text-muted">
              {member.email}
            </span>
          </div>
          <RolePills roles={member.roles} />
          {onRemove &&
            member.status === "active" &&
            member.user_id !== currentUserId && (
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Remove member ${member.full_name || member.email}`}
                onClick={() => onRemove(member)}
              >
                Remove
              </Button>
            )}
          {onRemove &&
            (member.status !== "active" ||
              member.user_id === currentUserId) && (
              <span className="w-20" aria-hidden="true" />
            )}
        </li>
      ))}
    </ul>
  )
}

function ActiveAssignmentRows({
  assignments,
  members,
  canRevoke,
}: {
  assignments: TeamRoleAssignment[]
  members: TeamMember[]
  canRevoke: boolean
}) {
  const revokeRole = useRevokeTeamRole()
  const team = useDisplayedTeam()
  const { addToast } = useToast()
  const [revoking, setRevoking] = useState<
    (TeamRoleAssignment & { team: TeamScope }) | null
  >(null)

  useEffect(() => {
    if (revoking && !sameTeam(revoking.team, team)) setRevoking(null)
  }, [revoking, team])

  const activeAssignments = assignments.filter(
    (assignment) => !assignment.revoked_at,
  )

  if (activeAssignments.length === 0) {
    return (
      <div className="border border-border bg-background/60 px-4 py-6 text-sm text-muted">
        No active role assignments.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto border border-dashed border-border bg-background/60">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Member</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Granted</TableHead>
            {canRevoke && <TableHead />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {activeAssignments.map((assignment) => {
            const ownerBlocked =
              assignment.role_name === "team_owner" &&
              ownerRemovalBlocked(members, assignment.user_id)
            return (
              <TableRow key={assignment.assignment_id}>
                <TableCell>
                  <div className="font-medium text-foreground">
                    <span data-mask>{assignment.email}</span>
                  </div>
                </TableCell>
                <TableCell>{roleLabel(assignment.role_name)}</TableCell>
                <TableCell
                  className="text-muted tabular-nums"
                  suppressHydrationWarning
                >
                  {new Date(assignment.granted_at).toLocaleDateString()}
                </TableCell>
                {canRevoke && (
                  <TableCell>
                    <div className="flex flex-col items-start gap-1 lg:flex-row lg:items-center lg:gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="shrink-0"
                        disabled={revokeRole.isPending || ownerBlocked}
                        title={ownerBlocked ? LAST_OWNER_REASON : undefined}
                        aria-describedby={
                          ownerBlocked
                            ? `owner-reason-${assignment.assignment_id}`
                            : undefined
                        }
                        onClick={() => {
                          if (team) setRevoking({ ...assignment, team })
                        }}
                      >
                        Revoke
                      </Button>
                      {ownerBlocked && (
                        <span
                          id={`owner-reason-${assignment.assignment_id}`}
                          className="text-xs text-muted lg:whitespace-nowrap"
                        >
                          {LAST_OWNER_REASON}
                        </span>
                      )}
                    </div>
                  </TableCell>
                )}
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => {
          if (!open) setRevoking(null)
        }}
        title="Revoke role"
        description={`Revoke ${revoking ? roleLabel(revoking.role_name) : "this role"} from ${revoking?.email ?? "this member"}?`}
        confirmLabel="Revoke"
        onConfirm={async () => {
          if (!revoking) return
          if (!sameTeam(revoking.team, team)) {
            setRevoking(null)
            addToast(TEAM_CHANGED_MESSAGE, "error")
            return
          }
          if (
            revoking.role_name === "team_owner" &&
            ownerRemovalBlocked(members, revoking.user_id)
          ) {
            addToast(LAST_OWNER_REASON, "error")
            return
          }
          await revokeRole
            .mutateAsync({
              team: revoking.team,
              assignmentId: revoking.assignment_id,
            })
            .catch(() => {})
        }}
      />
    </div>
  )
}

export function TeamClient() {
  const { data, isPending, error, refetch } = useTeamManagement()
  const [selectedUserId, setSelectedUserId] = useState("")
  const [removing, setRemoving] = useState<
    (TeamMember & { team: TeamScope }) | null
  >(null)
  const removeMember = useRemoveTeamMember()
  const team = useDisplayedTeam()
  const leaveScope = useLeaveScope()
  const dashboardTeam = useDashboardTeamContext()
  const displayedTeamName = useTeamName(team)
  const teamName = dashboardTeam?.name.trim() || displayedTeamName
  // Leaving acts on the operator's own membership, not the team being viewed.
  const impersonating = dashboardTeam !== null
  const { addToast } = useToast()

  useEffect(() => {
    if (removing && !sameTeam(removing.team, team)) setRemoving(null)
  }, [removing, team])

  const { user } = useUser()

  if (isPending) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="Team" description={teamName}>
          <div className="h-9 w-28 border border-border bg-muted/30" />
        </PageHeader>
        <div className="flex-1 overflow-y-auto px-6 py-8">
          <TableSkeleton columns={5} />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="Team" description={teamName} />
        <ErrorState message={error.message} onRetry={() => refetch()} />
        {/* Leaving needs no team-management permission. */}
        {!impersonating &&
          error instanceof ApiError &&
          error.status === 403 && (
            <div className="px-6 pb-8">
              <div className="mx-auto w-full max-w-3xl">
                {/* Owners hold every management permission, so a 403 means the user is not an owner. */}
                <LeaveTeamSection team={leaveScope} ownerBlocked={false} />
              </div>
            </div>
          )}
      </div>
    )
  }

  if (!data || data.members.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="Team" description={teamName} />
        <EmptyState
          icon={UsersIcon}
          title="No team members"
          description="Team members will appear here once they are added to this team."
        />
      </div>
    )
  }

  const capabilities = data.capabilities
  // Role changes are platform-staff tools; the proxy enforces the same rule.
  const isStaff = canViewOtherUsersAccount(user)
  const canAssignRoles =
    isStaff && capabilities.can_assign_roles && capabilities.can_revoke_roles
  const canRevokeRoles = isStaff && capabilities.can_revoke_roles
  const assignableRoles = data.mutation_options?.assignable_roles ?? []
  const activeMembers = data.members.filter(
    (member) => member.status === "active",
  )
  const selectedManageRoleUserId = activeMembers.some(
    (member) => member.user_id === selectedUserId,
  )
    ? selectedUserId
    : (activeMembers[0]?.user_id ?? "")

  const members = data.members.filter((member) => member.status !== "inactive")
  const removedMembers = data.members.filter(
    (member) => member.status === "inactive",
  )

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader title="Team" description={teamName} />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-10 px-6 py-10 sm:px-8">
          <InviteMemberCard
            state={inviteControlState(capabilities)}
            invitableRoles={capabilities.invitable_roles}
            canChangeRoles={canAssignRoles || canRevokeRoles}
          />
          <section aria-labelledby="members-title">
            <div className="flex items-baseline gap-2">
              <h2
                id="members-title"
                className="text-base font-medium tracking-tight"
              >
                Members
              </h2>
              <span className="font-mono text-sm text-muted">
                {members.length}
              </span>
            </div>
            <MemberList
              members={members}
              currentUserId={user?.id}
              onRemove={
                capabilities.can_deactivate_members
                  ? (member) => {
                      if (team) setRemoving({ ...member, team })
                    }
                  : undefined
              }
            />
            {!capabilities.can_invite_members && (
              <p className="mt-4 text-sm text-muted">
                You have read-only access to team membership.
              </p>
            )}
          </section>
          {removedMembers.length > 0 && (
            <details className="text-muted">
              <summary className="cursor-pointer text-sm">
                Removed members ({removedMembers.length})
              </summary>
              <MemberList members={removedMembers} currentUserId={user?.id} />
            </details>
          )}
          {isStaff && capabilities.can_view_role_assignments && (
            <section className="space-y-4">
              <h2 className="text-base font-medium tracking-tight">
                Role assignments
              </h2>
              {canAssignRoles && (
                <ChangeRoleForm
                  members={data.members}
                  assignments={data.assignments}
                  roles={assignableRoles}
                  selectedUserId={selectedManageRoleUserId}
                  onSelectedUserIdChange={setSelectedUserId}
                />
              )}
              <ActiveAssignmentRows
                assignments={data.assignments}
                members={data.members}
                canRevoke={canRevokeRoles}
              />
            </section>
          )}
          <InvitationsSection
            canResend={capabilities.can_invite_owners === true}
            canRevoke={
              capabilities.can_invite_members && capabilities.can_assign_roles
            }
          />
          {!impersonating && (
            <section className="space-y-4">
              <h2 className="text-base font-medium tracking-tight">
                Danger zone
              </h2>
              {/* Owners always hold roles:read, so hidden roles mean the user is not an owner. */}
              <LeaveTeamSection
                team={leaveScope}
                ownerBlocked={
                  capabilities.can_view_role_assignments &&
                  ownerRemovalBlocked(data.members, user?.id)
                }
              />
            </section>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null)
        }}
        title="Remove member"
        description={`${removing?.email ?? "This member"} will lose access to this team.`}
        confirmLabel="Remove"
        onConfirm={async () => {
          if (removing) {
            if (!sameTeam(removing.team, team)) {
              setRemoving(null)
              addToast(TEAM_CHANGED_MESSAGE, "error")
              return
            }
            await removeMember
              .mutateAsync({ team: removing.team, userId: removing.user_id })
              .catch(() => {})
          }
        }}
      />
    </div>
  )
}
