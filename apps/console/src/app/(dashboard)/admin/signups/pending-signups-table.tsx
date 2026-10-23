"use client"

import { UserCheckIcon } from "@phosphor-icons/react"
import {
  Table,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@superserve/ui"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"

import { EmptyState } from "@/components/empty-state"
import { PageHeader } from "@/components/page-header"
import { StickyHoverTableBody } from "@/components/sticky-hover-table"
import type {
  SignupReviewResult,
  SignupReviewRow,
} from "@/lib/admin/signup-approval"
import { formatDate } from "@/lib/format"

type ReviewAction = (userId: string) => Promise<SignupReviewResult>

const actionButton =
  "inline-flex h-8 items-center justify-center border border-dashed border-border px-3 font-mono text-xs text-foreground uppercase transition-colors hover:bg-muted/30 disabled:opacity-50"

const OUTCOME_LABELS = {
  approved: "Approved — link sent",
  resent: "Link resent",
  rejected: "Rejected",
} as const

function ReviewButtons({
  row,
  onApprove,
  onReject,
}: {
  row: SignupReviewRow
  onApprove: ReviewAction
  onReject: ReviewAction
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  const run = (action: ReviewAction) =>
    startTransition(async () => {
      try {
        const result = await action(row.id)
        setMessage(result.ok ? OUTCOME_LABELS[result.outcome] : result.error)
        router.refresh()
      } catch {
        setMessage("Something went wrong. Please retry.")
      }
    })
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <button
          type="button"
          className={actionButton}
          disabled={pending}
          onClick={() => run(onApprove)}
        >
          {row.status === "pending" ? "Approve & send link" : "Resend link"}
        </button>
        {row.status === "pending" && (
          <button
            type="button"
            className={actionButton}
            disabled={pending}
            onClick={() => run(onReject)}
          >
            Reject
          </button>
        )}
      </div>
      {message && (
        <output className="text-xs text-muted" aria-live="polite">
          {message}
        </output>
      )}
    </div>
  )
}

function ReviewTable({
  rows,
  onApprove,
  onReject,
}: {
  rows: SignupReviewRow[]
  onApprove: ReviewAction
  onReject: ReviewAction
}) {
  return (
    <Table>
      <TableHeader className="sticky top-0 z-10 bg-background/70 backdrop-blur-md">
        <TableRow>
          <TableHead>User</TableHead>
          <TableHead>Provider</TableHead>
          <TableHead>Company</TableHead>
          <TableHead>Affiliation</TableHead>
          <TableHead>Interested in</TableHead>
          <TableHead>Signed up</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <StickyHoverTableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell>
              <div className="font-medium">{row.name ?? "—"}</div>
              <div className="text-xs text-muted">{row.email ?? "—"}</div>
            </TableCell>
            <TableCell className="font-mono text-xs text-muted uppercase">
              {row.provider}
            </TableCell>
            <TableCell>{row.company ?? "—"}</TableCell>
            <TableCell>
              <div>{row.affiliation ?? "—"}</div>
              {row.ycLink && (
                <a
                  href={row.ycLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-muted underline underline-offset-2 hover:text-foreground"
                >
                  YC link
                </a>
              )}
            </TableCell>
            <TableCell>{row.plan ?? "—"}</TableCell>
            <TableCell className="text-muted tabular-nums">
              {formatDate(new Date(row.createdAt))}
            </TableCell>
            <TableCell className="text-right">
              <ReviewButtons
                row={row}
                onApprove={onApprove}
                onReject={onReject}
              />
            </TableCell>
          </TableRow>
        ))}
      </StickyHoverTableBody>
    </Table>
  )
}

export function PendingSignupsTable({
  pending,
  awaiting,
  onApprove,
  onReject,
}: {
  pending: SignupReviewRow[]
  awaiting: SignupReviewRow[]
  onApprove: ReviewAction
  onReject: ReviewAction
}) {
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Pending Signups" />
      <div className="flex-1 overflow-y-auto">
        {pending.length === 0 ? (
          <EmptyState
            icon={UserCheckIcon}
            title="No Pending Signups"
            description="New signups awaiting review will appear here."
          />
        ) : (
          <ReviewTable
            rows={pending}
            onApprove={onApprove}
            onReject={onReject}
          />
        )}
        {awaiting.length > 0 && (
          <section className="mt-8">
            <h2 className="border-y border-dashed border-border px-4 py-2 font-mono text-xs text-muted uppercase">
              Approved — awaiting first sign-in
            </h2>
            <ReviewTable
              rows={awaiting}
              onApprove={onApprove}
              onReject={onReject}
            />
          </section>
        )}
      </div>
    </div>
  )
}
