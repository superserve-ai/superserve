"use client"

import {
  EnvelopeSimpleIcon,
  PaperPlaneTiltIcon,
  SignOutIcon,
} from "@phosphor-icons/react"
import {
  Button,
  ConfirmDialog,
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogPopup,
  DialogTitle,
  Field,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useToast,
} from "@superserve/ui"
import { useRouter } from "next/navigation"
import { type FormEvent, useState } from "react"

import {
  useCreateInvitation,
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
} from "@/lib/api/team-management"
import { INVITE_COPY } from "@/lib/invite/copy"

export type InviteControlState = "hidden" | "enabled" | "blocked_free_plan"

/**
 * What the invite control looks like for these capabilities. Free-plan teams
 * see the control grayed out with the upgrade reason; anyone without the
 * backend's go-ahead sees nothing.
 */
export function inviteControlState(
  capabilities: TeamManagementCapabilities,
): InviteControlState {
  if (!capabilities.can_invite_members) return "hidden"
  if (capabilities.invite_blocked_reason === "free_plan") {
    return "blocked_free_plan"
  }
  return capabilities.can_invite_owners ? "enabled" : "hidden"
}

export const UPGRADE_REASON = "Upgrade to invite owners"

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function InviteDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [email, setEmail] = useState("")
  const [error, setError] = useState<string | null>(null)
  const createInvitation = useCreateInvitation()
  const { addToast } = useToast()

  const reset = () => {
    setEmail("")
    setError(null)
    createInvitation.reset()
  }

  const handleOpenChange = (next: boolean) => {
    if (!next) reset()
    onOpenChange(next)
  }

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const value = email.trim()
    if (!EMAIL_PATTERN.test(value)) {
      setError("Enter a valid email address.")
      return
    }
    setError(null)
    createInvitation.mutate(value, {
      onSuccess: (result) => {
        if (result.delivery === "sent") {
          addToast(`Invitation sent to ${result.invitation.email}`, "success")
        } else {
          addToast(
            "The invitation was created but its email could not be sent. Use Resend to try again.",
            "error",
          )
        }
        handleOpenChange(false)
      },
      onError: (failure) => {
        // An unaccepted invitation (even an expired one) blocks a new one for
        // the same email; the list behind the dialog has Resend and Revoke.
        if ((failure as { code?: string }).code === "invitation_pending") {
          addToast(failure.message, "error")
          handleOpenChange(false)
          return
        }
        setError(failure.message)
      },
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogPopup>
        <form onSubmit={onSubmit} className="p-6">
          <DialogTitle>Invite an owner</DialogTitle>
          <DialogDescription className="mt-2">
            {INVITE_COPY.ownerNotice} Everyone you invite joins as an Owner. The
            invitation link expires after 7 days.
          </DialogDescription>
          <div className="mt-4">
            <Field label="Email address" error={error ?? undefined}>
              <Input
                type="email"
                autoComplete="off"
                placeholder="name@company.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>
          </div>
          <DialogFooter className="mt-6 p-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={createInvitation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!email.trim() || createInvitation.isPending}
            >
              <PaperPlaneTiltIcon className="size-3.5" weight="light" />
              {createInvitation.isPending ? "Sending..." : "Send invitation"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  )
}

export function InviteMemberCard({ state }: { state: InviteControlState }) {
  const [open, setOpen] = useState(false)
  if (state === "hidden") return null
  const blocked = state === "blocked_free_plan"

  return (
    <div className="border border-dashed border-border/80 bg-background/75 p-6 backdrop-blur-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-lg font-medium text-foreground">Invite member</p>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Invite people by email. They join as Owners with full access to this
            team.
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
          onClick={() => setOpen(true)}
        >
          <EnvelopeSimpleIcon className="size-3.5" weight="light" />
          Invite member
        </Button>
      </div>
      {!blocked && <InviteDialog open={open} onOpenChange={setOpen} />}
    </div>
  )
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString()
}

function invitationStatusLabel(invitation: TeamInvitation): string {
  if (invitation.status === "pending") {
    return invitation.delivery_status === "failed"
      ? "Pending, email not sent"
      : "Pending"
  }
  return invitation.status.charAt(0).toUpperCase() + invitation.status.slice(1)
}

/**
 * Anyone the backend lets read invitations sees the list; `canManage` (the
 * backend's owner-invite capability) separately gates Resend and Revoke.
 */
export function InvitationsSection({ canManage }: { canManage: boolean }) {
  const { data, isPending, error, refetch } = useTeamInvitations()
  const resend = useResendInvitation()
  const revoke = useRevokeInvitation()
  const [revoking, setRevoking] = useState<TeamInvitation | null>(null)

  // The backend is the authority on who may read the list: a refusal means
  // this user has no invitations view, not that something broke.
  if (error instanceof ApiError && error.status === 403) return null

  const invitations = (data?.invitations ?? []).filter(
    (invitation) =>
      invitation.status === "pending" || invitation.status === "expired",
  )

  return (
    <section className="border border-dashed border-border/80 bg-background/75 p-6 backdrop-blur-sm">
      <p className="text-lg font-medium text-foreground">Email invitations</p>
      <p className="mt-1 mb-4 text-sm text-muted">
        Invitations that have not been accepted yet.
      </p>

      {isPending ? (
        <div className="border border-dashed border-border bg-background/60 px-4 py-6 text-sm text-muted">
          Loading invitations...
        </div>
      ) : error ? (
        <div className="flex items-center justify-between gap-4 border border-dashed border-border bg-background/60 px-4 py-6 text-sm text-muted">
          <span>Invitations could not be loaded.</span>
          <Button size="sm" variant="outline" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      ) : invitations.length === 0 ? (
        <div className="border border-dashed border-border bg-background/60 px-4 py-6 text-sm text-muted">
          No pending invitations.
        </div>
      ) : (
        <div className="overflow-hidden border border-dashed border-border bg-background/60">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Expires</TableHead>
                {canManage && <TableHead className="w-48" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {invitations.map((invitation) => (
                <TableRow key={invitation.id}>
                  <TableCell className="font-medium text-foreground">
                    {invitation.email}
                  </TableCell>
                  <TableCell className="text-muted">
                    {invitationStatusLabel(invitation)}
                  </TableCell>
                  <TableCell
                    className="text-muted tabular-nums"
                    suppressHydrationWarning
                  >
                    {formatDate(invitation.expires_at)}
                  </TableCell>
                  {canManage && (
                    <TableCell>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={resend.isPending}
                          onClick={() => resend.mutate(invitation.id)}
                        >
                          Resend
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={revoke.isPending}
                          onClick={() => setRevoking(invitation)}
                        >
                          Revoke invitation
                        </Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
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
          if (revoking) await revoke.mutateAsync(revoking.id).catch(() => {})
        }}
      />
    </section>
  )
}

export const LEAVE_BLOCKED_REASON =
  "This is your only team, so you can't leave it. Create or join another team first."

export function LeaveTeamSection() {
  const router = useRouter()
  const teams = useTeams()
  const leave = useLeaveTeam()
  const { addToast } = useToast()
  const [confirming, setConfirming] = useState(false)

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
          onClick={() => setConfirming(true)}
        >
          <SignOutIcon className="size-3.5" weight="light" />
          Leave team
        </Button>
      </div>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Leave team"
        description="You will lose access to this team. A team needs at least one owner, so you can't leave if you are the last one."
        confirmLabel="Leave team"
        onConfirm={async () => {
          try {
            await leave.mutateAsync()
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
