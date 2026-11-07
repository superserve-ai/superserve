"use client"

import { EnvelopeSimpleIcon, SignOutIcon } from "@phosphor-icons/react"
import { Button, ConfirmDialog, useToast } from "@superserve/ui"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"

import {
  sameTeam,
  TEAM_CHANGED_MESSAGE,
  useDisplayedTeam,
  useLeaveTeam,
  useResendInvitation,
  useRevokeInvitation,
  useTeamInvitations,
} from "@/hooks/use-team-management"
import { useTeams } from "@/hooks/use-teams"
import { ApiError } from "@/lib/api/client"
import type {
  TeamInvitation,
  TeamManagementCapabilities,
  TeamScope,
} from "@/lib/api/team-management"
import { INVITE_UPGRADE_REASON, roleLabel } from "@/lib/team/roles"

import { InviteMembersDialog } from "./invite-members-dialog"

export type InviteControlState = "hidden" | "enabled" | "blocked_free_plan"

/**
 * What the invite control looks like for these capabilities. Free-plan teams
 * see the control grayed out with the upgrade reason; anyone without the
 * backend's go-ahead sees an explanation.
 */
export function inviteControlState(
  capabilities: TeamManagementCapabilities,
): InviteControlState {
  if (!capabilities.can_invite_members) return "hidden"
  if (capabilities.invite_blocked_reason === "free_plan") {
    return "blocked_free_plan"
  }
  if (capabilities.invitable_roles !== undefined) {
    return capabilities.invitable_roles.length > 0 ? "enabled" : "hidden"
  }
  return capabilities.can_invite_owners ? "enabled" : "hidden"
}

export const UPGRADE_REASON = INVITE_UPGRADE_REASON

export function InviteMemberCard({
  state,
  invitableRoles,
}: {
  state: InviteControlState
  invitableRoles?: string[]
}) {
  const [inviting, setInviting] = useState<TeamScope | null>(null)
  const team = useDisplayedTeam()

  useEffect(() => {
    if (inviting && !sameTeam(inviting, team)) setInviting(null)
  }, [inviting, team])

  if (state === "hidden") {
    return (
      <section>
        <p className="text-sm text-muted">
          Only Owners can invite people or change roles.
        </p>
      </section>
    )
  }
  const blocked = state === "blocked_free_plan"

  return (
    <section>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-medium tracking-tight">
            Invite people
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Invite teammates and give them the access they need.
          </p>
          {blocked && (
            <p className="mt-2 text-sm text-muted">{UPGRADE_REASON}</p>
          )}
        </div>
        <Button
          type="button"
          size="sm"
          disabled={blocked}
          title={blocked ? UPGRADE_REASON : undefined}
          onClick={() => {
            if (team) setInviting(team)
          }}
        >
          <EnvelopeSimpleIcon className="size-3.5" weight="light" />
          Invite
        </Button>
      </div>
      {!blocked && inviting && (
        <InviteMembersDialog
          team={inviting}
          invitableRoles={invitableRoles}
          onOpenChange={(open) => {
            if (!open) setInviting(null)
          }}
        />
      )}
    </section>
  )
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString()
}

/**
 * Anyone the backend lets read invitations sees the list. Resend follows the
 * owner-invite capability, which a Free plan withholds; Revoke needs only the
 * permissions, so a downgraded team can still withdraw a pending invitation.
 */
export function InvitationsSection({
  canResend,
  canRevoke,
}: {
  canResend: boolean
  canRevoke: boolean
}) {
  const { data, isPending, error, refetch } = useTeamInvitations()
  const resend = useResendInvitation()
  const revoke = useRevokeInvitation()
  const [revoking, setRevoking] = useState<
    (TeamInvitation & { team: TeamScope }) | null
  >(null)

  const team = useDisplayedTeam()
  const { addToast } = useToast()

  useEffect(() => {
    if (revoking && !sameTeam(revoking.team, team)) setRevoking(null)
  }, [revoking, team])

  // The backend is the authority on who may read the list: a refusal means
  // this user has no invitations view, not that something broke.
  if (error instanceof ApiError && error.status === 403) return null

  const invitations = (data?.invitations ?? []).filter(
    (invitation) =>
      invitation.status === "pending" || invitation.status === "expired",
  )

  if (!isPending && !error && invitations.length === 0) return null

  return (
    <section aria-labelledby="pending-title">
      <div className="flex items-baseline gap-2">
        <h2 id="pending-title" className="text-base font-medium tracking-tight">
          Pending invitations
        </h2>
        <span className="font-mono text-sm text-muted">
          {invitations.length}
        </span>
      </div>
      {isPending ? (
        <p className="mt-4 text-sm text-muted">Loading invitations...</p>
      ) : error ? (
        <div className="mt-4 flex items-center justify-between gap-4 text-sm text-muted">
          <span>Invitations could not be loaded.</span>
          <Button size="sm" variant="outline" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-dashed divide-border border border-dashed border-border">
          {invitations.map((invitation) => (
            <li
              key={invitation.id}
              className="flex flex-wrap items-center gap-3 px-4 py-3"
            >
              <EnvelopeSimpleIcon
                className="size-5 shrink-0 text-muted"
                weight="light"
              />
              <div className="min-w-0 flex-1">
                <span data-mask className="text-sm break-all">
                  {invitation.email}
                </span>
                <p className="mt-1 text-xs text-muted" suppressHydrationWarning>
                  Sent{" "}
                  {formatDate(invitation.last_sent_at ?? invitation.created_at)}{" "}
                  · Expires {formatDate(invitation.expires_at)}
                </p>
                {invitation.delivery_status === "failed" && (
                  <p className="mt-1 text-xs text-destructive">
                    Pending, email not sent
                  </p>
                )}
                {invitation.status === "expired" && (
                  <p className="mt-1 text-xs text-muted">Expired</p>
                )}
              </div>
              {invitation.role && (
                <span className="border border-dashed border-border px-2 py-0.5 font-mono text-[11px] uppercase">
                  {roleLabel(invitation.role)}
                </span>
              )}
              {canResend && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={resend.isPending}
                  onClick={() =>
                    resend.mutate({ team, invitationId: invitation.id })
                  }
                >
                  Resend
                </Button>
              )}
              {canRevoke && (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Revoke invitation to ${invitation.email}`}
                  disabled={revoke.isPending}
                  onClick={() => {
                    if (team) setRevoking({ ...invitation, team })
                  }}
                >
                  Revoke
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => {
          if (!open) setRevoking(null)
        }}
        title="Revoke invitation"
        description={`${revoking?.email ?? "This person"} will no longer be able to join with this invitation link.`}
        confirmLabel="Revoke"
        onConfirm={async () => {
          if (!revoking) return
          if (!sameTeam(revoking.team, team)) {
            setRevoking(null)
            addToast(TEAM_CHANGED_MESSAGE, "error")
            return
          }
          await revoke
            .mutateAsync({ team: revoking.team, invitationId: revoking.id })
            .catch(() => {})
        }}
      />
    </section>
  )
}

export const LEAVE_BLOCKED_REASON =
  "This is your only team, so you can't leave it. Create or join another team first."

// The scope comes from the page: an extra observer of a failed management
// query would refetch it on mount, sending the page back to its loading state.
export function LeaveTeamSection({ team }: { team: TeamScope | null }) {
  const router = useRouter()
  const teams = useTeams()
  const leave = useLeaveTeam()
  const { addToast } = useToast()
  const [confirming, setConfirming] = useState<TeamScope | null>(null)

  useEffect(() => {
    if (confirming && !sameTeam(confirming, team)) setConfirming(null)
  }, [confirming, team])

  // Fail closed: until the directory says there is another team, block.
  const teamCount = teams.data?.teams.length
  const onlyTeam = teamCount === undefined || teamCount <= 1
  const blockedKnown = teamCount !== undefined && teamCount <= 1

  return (
    <section className="border border-dashed border-border/80 bg-background/75 p-6 backdrop-blur-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-lg font-medium text-foreground">Leave team</p>
          <p className="mt-1 text-sm text-muted">
            {blockedKnown
              ? LEAVE_BLOCKED_REASON
              : "You will lose access to this team and switch to another one."}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={onlyTeam || leave.isPending}
          title={blockedKnown ? LEAVE_BLOCKED_REASON : undefined}
          onClick={() => {
            if (team) setConfirming(team)
          }}
        >
          <SignOutIcon className="size-3.5" weight="light" />
          Leave team
        </Button>
      </div>

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null)
        }}
        title="Leave team"
        description="You will lose access to this team. A team needs at least one owner, so you can't leave if you are the last one."
        confirmLabel="Leave team"
        onConfirm={async () => {
          try {
            if (!sameTeam(confirming, team)) {
              setConfirming(null)
              addToast(TEAM_CHANGED_MESSAGE, "error")
              return
            }
            await leave.mutateAsync({ team: confirming })
            addToast("You left the team", "success")
            router.replace("/sandboxes/")
          } catch (failure) {
            addToast(
              failure instanceof Error
                ? failure.message
                : "Could not leave the team.",
              "error",
            )
          }
        }}
      />
    </section>
  )
}
