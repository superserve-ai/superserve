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
import type { EnterprisePlanVersion } from "@/lib/admin/enterprise-plan"
import type {
  SignupReviewResult,
  SignupReviewRow,
} from "@/lib/admin/signup-approval"
import { formatDate } from "@/lib/format"

type ApproveAction = (
  userId: string,
  planVersionId: string,
) => Promise<SignupReviewResult>
type ReviewAction = (userId: string) => Promise<SignupReviewResult>

const actionButton =
  "inline-flex h-8 items-center justify-center border border-dashed border-border px-3 font-mono text-xs text-foreground uppercase transition-colors hover:bg-muted/30 disabled:opacity-50"

const OUTCOME_LABELS = {
  approved: "Access granted — email sent",
  rejected: "Rejected",
} as const

function ReviewButtons({
  row,
  versions,
  onApprove,
  onReject,
}: {
  row: SignupReviewRow
  versions: EnterprisePlanVersion[]
  onApprove: ApproveAction
  onReject: ReviewAction
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  const [versionId, setVersionId] = useState(versions[0]?.id ?? "")
  const resend = row.status === "approved"
  const run = (action: () => Promise<SignupReviewResult>) =>
    startTransition(async () => {
      try {
        const result = await action()
        setMessage(result.ok ? OUTCOME_LABELS[result.outcome] : result.error)
        router.refresh()
      } catch {
        setMessage("Something went wrong. Please retry.")
      }
    })
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        {!resend && (
          <select
            aria-label="Enterprise plan"
            className="h-8 border border-dashed border-border bg-background px-2 text-xs"
            value={versionId}
            disabled={pending || versions.length === 0}
            onChange={(event) => setVersionId(event.target.value)}
          >
            {versions.length === 0 ? (
              <option value="">No Enterprise plans published</option>
            ) : (
              versions.map((version) => (
                <option key={version.id} value={version.id}>
                  {version.name}
                </option>
              ))
            )}
          </select>
        )}
        <button
          type="button"
          className={actionButton}
          disabled={pending || (!resend && !versionId)}
          onClick={() => run(() => onApprove(row.id, resend ? "" : versionId))}
        >
          {resend ? "Resend email" : "Grant access"}
        </button>
        {!resend && (
          <button
            type="button"
            className={actionButton}
            disabled={pending}
            onClick={() => run(() => onReject(row.id))}
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
  versions,
  onApprove,
  onReject,
}: {
  rows: SignupReviewRow[]
  versions: EnterprisePlanVersion[]
  onApprove: ApproveAction
  onReject: ReviewAction
}) {
  return (
    <Table>
      <TableHeader className="sticky top-0 z-10 bg-background/70 backdrop-blur-md">
        <TableRow>
          <TableHead>User</TableHead>
          <TableHead>Provider</TableHead>
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
            <TableCell className="text-muted tabular-nums">
              {formatDate(new Date(row.createdAt))}
            </TableCell>
            <TableCell className="text-right">
              <ReviewButtons
                row={row}
                versions={versions}
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
  versions,
  onApprove,
  onReject,
}: {
  pending: SignupReviewRow[]
  versions: EnterprisePlanVersion[]
  onApprove: ApproveAction
  onReject: ReviewAction
}) {
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Pending Enterprise Signups" />
      <div className="flex-1 overflow-y-auto">
        {pending.length === 0 ? (
          <EmptyState
            icon={UserCheckIcon}
            title="No Pending Signups"
            description="Enterprise signups waiting for setup will appear here."
          />
        ) : (
          <ReviewTable
            rows={pending}
            versions={versions}
            onApprove={onApprove}
            onReject={onReject}
          />
        )}
      </div>
    </div>
  )
}
