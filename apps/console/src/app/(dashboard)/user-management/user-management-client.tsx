"use client"

import {
  PlusIcon,
  ShieldCheckIcon,
  TrashIcon,
  UsersIcon,
} from "@phosphor-icons/react"
import {
  Button,
  Field,
  Input,
  Separator,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@superserve/ui"
import { useMemo, useState } from "react"
import type { FormEvent } from "react"

import { EmptyState } from "@/components/empty-state"
import { ErrorState } from "@/components/error-state"
import { PageHeader } from "@/components/page-header"
import { TableSkeleton } from "@/components/table-skeleton"
import {
  useAddTeamMember,
  useAssignTeamRole,
  useDeactivateTeamMember,
  useRevokeTeamRole,
  useTeamManagement,
} from "@/hooks/use-team-management"
import type { TeamMember, TeamRoleAssignment } from "@/lib/api/team-management"

function roleLabel(role: string): string {
  return role
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function statusTone(status: TeamMember["status"]): string {
  if (status === "active") {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
  }
  if (status === "invited") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-300"
  }
  return "border-border bg-muted/30 text-muted"
}

function StatusBadge({ status }: { status: TeamMember["status"] }) {
  return (
    <span
      className={`border px-2 py-1 font-mono text-xs uppercase ${statusTone(status)}`}
    >
      {status}
    </span>
  )
}

function RolePills({ roles }: { roles?: string[] }) {
  if (!roles || roles.length === 0) {
    return <span className="text-xs text-muted">No active roles</span>
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {roles.map((role) => (
        <span
          key={role}
          className="border border-border bg-background px-2 py-1 text-xs text-foreground"
        >
          {roleLabel(role)}
        </span>
      ))}
    </div>
  )
}

function AddMemberForm({
  statuses,
}: {
  statuses: Array<"active" | "invited">
}) {
  const addMember = useAddTeamMember()
  const [userId, setUserId] = useState("")
  const [status, setStatus] = useState<"active" | "invited">(
    statuses.includes("invited") ? "invited" : "active",
  )

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmed = userId.trim()
    if (!trimmed) {
      return
    }
    addMember.mutate(
      { user_id: trimmed, status },
      {
        onSuccess: () => {
          setUserId("")
          setStatus(statuses.includes("invited") ? "invited" : "active")
        },
      },
    )
  }

  return (
    <form
      onSubmit={onSubmit}
      className="grid gap-3 md:grid-cols-[1fr_160px_auto]"
    >
      <Field label="User UUID">
        <Input
          value={userId}
          onChange={(event) => setUserId(event.target.value)}
          placeholder="00000000-0000-0000-0000-000000000000"
        />
      </Field>
      <Field label="Status">
        <select
          value={status}
          onChange={(event) =>
            setStatus(event.target.value as "active" | "invited")
          }
          className="h-9 w-full border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-foreground"
        >
          {statuses.map((option) => (
            <option key={option} value={option}>
              {option === "active" ? "Active" : "Invited"}
            </option>
          ))}
        </select>
      </Field>
      <div className="flex items-end">
        <Button
          type="submit"
          size="sm"
          disabled={!userId.trim() || addMember.isPending}
        >
          <PlusIcon className="size-3.5" weight="light" />
          {addMember.isPending ? "Adding..." : "Add member"}
        </Button>
      </div>
    </form>
  )
}

function AssignRoleForm({
  members,
  roles,
}: {
  members: TeamMember[]
  roles: string[]
}) {
  const assignRole = useAssignTeamRole()
  const activeMembers = members.filter((member) => member.status === "active")
  const [userId, setUserId] = useState("")
  const [roleName, setRoleName] = useState("")

  const selectedUserId = activeMembers.some(
    (member) => member.user_id === userId,
  )
    ? userId
    : (activeMembers[0]?.user_id ?? "")
  const selectedRoleName = roles.includes(roleName)
    ? roleName
    : (roles[0] ?? "")

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selectedUserId || !selectedRoleName) {
      return
    }
    assignRole.mutate({ user_id: selectedUserId, role_name: selectedRoleName })
  }

  if (activeMembers.length === 0 || roles.length === 0) {
    return (
      <p className="text-sm text-muted">
        Add an active member before assigning team roles.
      </p>
    )
  }

  return (
    <form
      onSubmit={onSubmit}
      className="grid gap-3 md:grid-cols-[1fr_200px_auto]"
    >
      <Field label="Member">
        <select
          value={selectedUserId}
          onChange={(event) => setUserId(event.target.value)}
          className="h-9 w-full border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-foreground"
        >
          {activeMembers.map((member) => (
            <option key={member.user_id} value={member.user_id}>
              {member.email}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Role">
        <select
          value={selectedRoleName}
          onChange={(event) => setRoleName(event.target.value)}
          className="h-9 w-full border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-foreground"
        >
          {roles.map((role) => (
            <option key={role} value={role}>
              {roleLabel(role)}
            </option>
          ))}
        </select>
      </Field>
      <div className="flex items-end">
        <Button
          type="submit"
          size="sm"
          disabled={
            !selectedUserId || !selectedRoleName || assignRole.isPending
          }
        >
          <ShieldCheckIcon className="size-3.5" weight="light" />
          {assignRole.isPending ? "Assigning..." : "Assign role"}
        </Button>
      </div>
    </form>
  )
}

function MemberActions({ member }: { member: TeamMember }) {
  const deactivate = useDeactivateTeamMember()
  const disabled = member.status !== "active" || deactivate.isPending

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={disabled}
      onClick={() => deactivate.mutate(member.user_id)}
    >
      <TrashIcon className="size-3.5" weight="light" />
      Deactivate
    </Button>
  )
}

function ActiveAssignmentRows({
  assignments,
  canRevoke,
}: {
  assignments: TeamRoleAssignment[]
  canRevoke: boolean
}) {
  const revokeRole = useRevokeTeamRole()
  const activeAssignments = assignments.filter(
    (assignment) => !assignment.revoked_at,
  )

  if (activeAssignments.length === 0) {
    return (
      <div className="px-4 py-6 text-sm text-muted">
        No active role assignments.
      </div>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Member</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Granted</TableHead>
          {canRevoke && <TableHead className="w-32" />}
        </TableRow>
      </TableHeader>
      <TableBody>
        {activeAssignments.map((assignment) => (
          <TableRow key={assignment.assignment_id}>
            <TableCell>
              <div className="font-medium text-foreground">
                {assignment.email}
              </div>
              <div className="font-mono text-xs text-muted">
                {assignment.user_id}
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
                <Button
                  size="sm"
                  variant="outline"
                  disabled={revokeRole.isPending}
                  onClick={() => revokeRole.mutate(assignment.assignment_id)}
                >
                  Revoke
                </Button>
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export function UserManagementClient() {
  const { data, isPending, error, refetch } = useTeamManagement()

  const counts = useMemo(() => {
    const members = data?.members ?? []
    return {
      active: members.filter((member) => member.status === "active").length,
      invited: members.filter((member) => member.status === "invited").length,
      inactive: members.filter((member) => member.status === "inactive").length,
    }
  }, [data?.members])

  if (isPending) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="User Management" />
        <TableSkeleton columns={5} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="User Management" />
        <ErrorState message={error.message} onRetry={() => refetch()} />
      </div>
    )
  }

  if (!data || data.members.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="User Management" />
        <EmptyState
          icon={UsersIcon}
          title="No team members"
          description="Team members will appear here once they are added to this team."
        />
      </div>
    )
  }

  const capabilities = data.capabilities
  const memberStatuses = data.mutation_options?.member_statuses ?? [
    "active",
    "invited",
  ]
  const assignableRoles = data.mutation_options?.assignable_roles ?? []
  const canMutateMembers =
    capabilities.can_invite_members || capabilities.can_deactivate_members
  const canMutateRoles =
    capabilities.can_assign_roles || capabilities.can_revoke_roles

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="User Management" />

      <div className="flex-1 overflow-y-auto">
        <div className="grid grid-cols-3 border-b border-border text-sm">
          <div className="px-6 py-4">
            <div className="font-mono text-2xl text-foreground">
              {counts.active}
            </div>
            <div className="text-muted">Active</div>
          </div>
          <div className="border-x border-border px-6 py-4">
            <div className="font-mono text-2xl text-foreground">
              {counts.invited}
            </div>
            <div className="text-muted">Invited</div>
          </div>
          <div className="px-6 py-4">
            <div className="font-mono text-2xl text-foreground">
              {counts.inactive}
            </div>
            <div className="text-muted">Inactive</div>
          </div>
        </div>

        {capabilities.can_invite_members && (
          <section className="grid grid-cols-[240px_1fr] gap-12 px-8 py-8">
            <div>
              <h2 className="text-base font-medium text-foreground">
                Add member
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                Add an existing profile as active or invited. Privileged
                reactivation remains enforced by the backend.
              </p>
            </div>
            <AddMemberForm statuses={memberStatuses} />
          </section>
        )}

        {capabilities.can_invite_members && <Separator />}

        <section className="px-8 py-8">
          <div className="mb-4 flex items-end justify-between gap-4">
            <div>
              <h2 className="text-base font-medium text-foreground">Members</h2>
              <p className="mt-1 text-xs text-muted">
                Inactive and invited members are shown separately from active
                members.
              </p>
            </div>
            {!canMutateMembers && (
              <p className="text-xs text-muted">
                You have read-only access to team membership.
              </p>
            )}
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Active roles</TableHead>
                <TableHead>Updated</TableHead>
                {capabilities.can_deactivate_members && (
                  <TableHead className="w-36" />
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.members.map((member) => (
                <TableRow key={member.user_id}>
                  <TableCell>
                    <div className="font-medium text-foreground">
                      {member.email}
                    </div>
                    <div className="font-mono text-xs text-muted">
                      {member.user_id}
                    </div>
                    {member.full_name && (
                      <div className="text-xs text-muted">
                        {member.full_name}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={member.status} />
                  </TableCell>
                  <TableCell>
                    <RolePills roles={member.roles} />
                  </TableCell>
                  <TableCell
                    className="text-muted tabular-nums"
                    suppressHydrationWarning
                  >
                    {new Date(member.updated_at).toLocaleDateString()}
                  </TableCell>
                  {capabilities.can_deactivate_members && (
                    <TableCell>
                      <MemberActions member={member} />
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>

        {capabilities.can_view_role_assignments && (
          <>
            <Separator />
            <section className="grid grid-cols-[240px_1fr] gap-12 px-8 py-8">
              <div>
                <h2 className="text-base font-medium text-foreground">
                  Role assignment
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-muted">
                  Role changes are submitted to the customer RBAC endpoints and
                  may be rejected by backend policy.
                </p>
              </div>
              <div className="space-y-6">
                {capabilities.can_assign_roles && (
                  <AssignRoleForm
                    members={data.members}
                    roles={assignableRoles}
                  />
                )}
                {!canMutateRoles && (
                  <p className="text-sm text-muted">
                    You can view role assignments, but cannot change them.
                  </p>
                )}
                <div className="border border-border">
                  <ActiveAssignmentRows
                    assignments={data.assignments}
                    canRevoke={capabilities.can_revoke_roles}
                  />
                </div>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  )
}
