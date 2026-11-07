"use client"

import { PaperPlaneTiltIcon, XIcon } from "@phosphor-icons/react"
import {
  Button,
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogPopup,
  DialogTitle,
  Input,
} from "@superserve/ui"
import { useEffect, useRef, useState } from "react"

import {
  sameTeam,
  TEAM_CHANGED_MESSAGE,
  useCreateInvitation,
  useDisplayedTeam,
} from "@/hooks/use-team-management"
import type { TeamScope } from "@/lib/api/team-management"
import {
  defaultInviteRole,
  invitableRoles,
  INVITE_UPGRADE_REASON,
  LEGACY_INVITE_NOTICE,
  TEAM_ROLES,
  knownTeamRole,
} from "@/lib/team/roles"

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_ROWS = 20
const GENERIC_ERROR = "Something went wrong. Please try again."
const ERROR_MESSAGES: Record<string, string> = {
  already_member: "Already a member",
  invitation_pending: "Already invited",
  bad_request: "Invalid email",
  invalid_role: "Role not allowed",
  pending_limit: "Too many pending invites",
  rate_limited: "Too many invites sent. Try again later.",
  free_plan: INVITE_UPGRADE_REASON,
  team_changed: TEAM_CHANGED_MESSAGE,
}

type InviteRow = {
  id: number
  email: string
  role?: string
  editing?: boolean
  status?: "sent" | "delivery_failed" | "error"
  message?: string
}

export function InviteMembersDialog({
  team,
  invitableRoles: allowed,
  onOpenChange,
}: {
  team: TeamScope
  invitableRoles?: string[]
  onOpenChange: (open: boolean) => void
}) {
  const rolesSupported = allowed !== undefined
  const roles = invitableRoles(allowed ?? [])
  const defaultRole = defaultInviteRole(roles)
  const [draft, setDraft] = useState("")
  const [rows, setRows] = useState<InviteRow[]>([])
  const [note, setNote] = useState("")
  const [sending, setSending] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const nextId = useRef(0)
  const rowsRef = useRef<HTMLUListElement>(null)
  const displayedTeam = useDisplayedTeam()
  const currentTeam = useRef(displayedTeam)
  currentTeam.current = displayedTeam
  const create = useCreateInvitation()
  const sent = rows.filter((row) => row.status === "sent").length
  const needsAttention = rows.length - sent

  useEffect(() => {
    if (attempted && !sending) {
      rowsRef.current
        ?.querySelector<HTMLLIElement>("li:not([data-status=sent])")
        ?.scrollIntoView?.({ block: "nearest" })
    }
  }, [attempted, sending])

  const addAddresses = (text: string) => {
    const addresses = text
      .split(/[,;\s]+/)
      .map((value) => value.trim())
      .filter(Boolean)
    setRows((previous) => {
      const result = [...previous]
      let duplicates = false
      let capped = false
      for (const email of addresses) {
        if (
          result.some((row) => row.email.toLowerCase() === email.toLowerCase())
        ) {
          duplicates = true
          continue
        }
        if (result.length === MAX_ROWS) {
          capped = true
          continue
        }
        result.push({ id: nextId.current++, email, role: defaultRole })
      }
      setNote(
        capped
          ? "You can invite up to 20 people at a time."
          : duplicates
            ? "Duplicate addresses ignored."
            : "",
      )
      return result
    })
    setDraft("")
  }

  const update = (id: number, patch: Partial<InviteRow>) => {
    setRows((previous) =>
      previous.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    )
  }
  const isComplete = (row: InviteRow) =>
    row.status === "sent" || row.status === "delivery_failed"
  const isDuplicate = (row: InviteRow) =>
    rows.some(
      (other) =>
        other.id !== row.id &&
        other.email.toLowerCase() === row.email.toLowerCase(),
    )
  const sendable = (row: InviteRow) =>
    !isComplete(row) &&
    !isDuplicate(row) &&
    EMAIL_PATTERN.test(row.email) &&
    row.email.length <= 320 &&
    (!rolesSupported || roles.some((role) => role === row.role))
  const close = (open: boolean) => {
    if (sending) return
    if (!open) {
      setRows([])
      setDraft("")
      setNote("")
      setAttempted(false)
      create.reset()
    }
    onOpenChange(open)
  }

  const send = async () => {
    if (sending) return
    setSending(true)
    setAttempted(true)
    const pending = rows.filter(sendable)
    try {
      for (let index = 0; index < pending.length; index++) {
        const row = pending[index]
        let changed = !sameTeam(team, currentTeam.current)
        if (!changed) {
          try {
            const result = await create.mutateAsync({
              team,
              email: row.email,
              ...(rolesSupported ? { role: row.role } : {}),
            })
            update(row.id, {
              status: result.delivery === "sent" ? "sent" : "delivery_failed",
              message:
                result.delivery === "sent"
                  ? "Sent"
                  : "Invite created, email failed",
            })
          } catch (error) {
            const code = (error as { code?: string })?.code
            changed = code === "team_changed"
            update(row.id, {
              status: "error",
              message: ERROR_MESSAGES[code ?? ""] ?? GENERIC_ERROR,
            })
          }
        }
        if (changed) {
          for (const remaining of pending.slice(index))
            update(remaining.id, {
              status: "error",
              message: TEAM_CHANGED_MESSAGE,
            })
          break
        }
      }
    } finally {
      try {
        await create.refreshInvitations()
      } finally {
        setSending(false)
      }
    }
  }

  return (
    <Dialog open onOpenChange={close}>
      <DialogPopup className="w-full max-w-2xl">
        <div className="p-6">
          <DialogTitle>Invite people</DialogTitle>
          <DialogDescription className="mt-2">
            {rolesSupported
              ? "Add email addresses and choose their access. Invitations expire after 7 days."
              : LEGACY_INVITE_NOTICE}
          </DialogDescription>
          <label htmlFor="invite-emails" className="mt-5 mb-2 block text-sm">
            Email addresses
          </label>
          <Input
            id="invite-emails"
            type="email"
            className="border-dashed"
            autoComplete="off"
            placeholder="name@example.com"
            value={draft}
            disabled={sending || rows.length >= MAX_ROWS}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (
                ["Enter", "Tab", ",", ";", " "].includes(event.key) &&
                draft.trim()
              ) {
                if (event.key !== "Tab") event.preventDefault()
                addAddresses(draft)
              }
            }}
            onBlur={() => {
              if (draft.trim()) addAddresses(draft)
            }}
            onPaste={(event) => {
              const text = event.clipboardData.getData("text")
              if (!text.trim()) return
              event.preventDefault()
              addAddresses(draft + text)
            }}
          />
          <p className="mt-2 text-xs text-muted">
            Paste a list or press Enter to add an address. Up to 20 people.
          </p>
          {note && (
            <output className="mt-2 block text-xs text-muted">{note}</output>
          )}
          {rows.length >= MAX_ROWS && (
            <p className="mt-2 text-xs text-muted">
              20-person limit reached. Remove a row to add someone else.
            </p>
          )}
          {rolesSupported && roles.length === 0 && (
            <p className="mt-2 text-xs text-muted">
              No invitation roles are available.
            </p>
          )}
          <ul
            ref={rowsRef}
            className="mt-4 max-h-[45vh] divide-y divide-dashed divide-border overflow-y-auto border border-dashed border-border empty:hidden"
          >
            {rows.map((row) => {
              const invalid =
                !EMAIL_PATTERN.test(row.email) || row.email.length > 320
              const complete = isComplete(row)
              const duplicate = isDuplicate(row)
              const role = knownTeamRole(row.role)
              return (
                <li key={row.id} data-status={row.status} className="px-3 py-3">
                  <div className="flex items-center gap-3">
                    <span
                      data-mask
                      className="min-w-0 flex-1 text-sm break-all"
                    >
                      {invalid || row.status === "error" || row.editing ? (
                        <input
                          aria-label={`Email for ${row.email}`}
                          value={row.email}
                          disabled={sending}
                          className="h-9 w-full border border-dashed border-border bg-background px-2 text-sm outline-none focus:border-brand"
                          onChange={(event) =>
                            update(row.id, {
                              email: event.target.value.trim(),
                              status: undefined,
                              message: undefined,
                              editing: true,
                            })
                          }
                          onBlur={() => update(row.id, { editing: false })}
                          onKeyDown={(event) => {
                            if (event.key === "Enter")
                              event.currentTarget.blur()
                          }}
                        />
                      ) : (
                        row.email
                      )}
                    </span>
                    {rolesSupported && (
                      <select
                        aria-label={`Role for ${row.email}`}
                        value={row.role ?? ""}
                        disabled={sending || complete}
                        onChange={(event) =>
                          update(row.id, {
                            role: event.target.value,
                            status: undefined,
                            message: undefined,
                          })
                        }
                        className="h-9 max-w-40 border border-dashed border-border bg-background px-2 text-sm"
                      >
                        {!row.role && (
                          <option value="" disabled>
                            Choose role
                          </option>
                        )}
                        {roles.map((role) => (
                          <option key={role} value={role}>
                            {TEAM_ROLES[role].label}
                          </option>
                        ))}
                      </select>
                    )}
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Remove ${row.email}`}
                      disabled={sending || complete}
                      onClick={() =>
                        setRows((previous) =>
                          previous.filter((item) => item.id !== row.id),
                        )
                      }
                    >
                      <XIcon className="size-4" weight="light" />
                    </Button>
                  </div>
                  {rolesSupported && role && (
                    <p className="mt-1 text-xs text-muted">
                      {TEAM_ROLES[role].description}
                    </p>
                  )}
                  {(invalid || duplicate || row.message) && (
                    <output
                      className={`mt-1 block text-xs ${invalid || duplicate || row.status === "error" || row.status === "delivery_failed" ? "text-destructive" : "text-brand"}`}
                    >
                      {invalid
                        ? "Invalid email"
                        : duplicate
                          ? "Address already added"
                          : row.message}
                    </output>
                  )}
                </li>
              )
            })}
          </ul>
          {attempted && !sending && rows.length > 0 && (
            <output
              className={`mt-2 block text-xs ${needsAttention > 0 ? "text-destructive" : "text-brand"}`}
            >
              {needsAttention > 0
                ? `${sent > 0 ? `${sent} sent. ` : ""}${needsAttention} ${needsAttention === 1 ? "needs" : "need"} attention.`
                : `${sent} sent.`}
            </output>
          )}
          <DialogFooter className="mt-6 p-0">
            <Button
              variant="outline"
              disabled={sending}
              onClick={() => close(false)}
            >
              {attempted ? "Close" : "Cancel"}
            </Button>
            <Button disabled={sending || !rows.some(sendable)} onClick={send}>
              <PaperPlaneTiltIcon className="size-3.5" weight="light" />
              {sending
                ? "Sending..."
                : attempted
                  ? "Retry failed"
                  : "Send invites"}
            </Button>
          </DialogFooter>
        </div>
      </DialogPopup>
    </Dialog>
  )
}
