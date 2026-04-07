"use client"

import {
  ArrowLeftIcon,
  CameraIcon,
  ClipboardTextIcon,
  CopyIcon,
  PlayIcon,
  StopIcon,
  TerminalIcon,
  TrashIcon,
} from "@phosphor-icons/react"
import {
  Badge,
  type BadgeVariant,
  Button,
  Table,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
  TooltipPopup,
  TooltipTrigger,
  useToast,
} from "@superserve/ui"
import { useQuery } from "@tanstack/react-query"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { usePostHog } from "posthog-js/react"
import { EmptyState } from "@/components/empty-state"
import { ErrorState } from "@/components/error-state"
import { StickyHoverTableBody } from "@/components/sticky-hover-table"
import {
  useDeleteSandbox,
  usePauseSandbox,
  useResumeSandbox,
  useSandbox,
} from "@/hooks/use-sandboxes"
import { listActivityBySandboxAction } from "@/lib/api/activity-actions"
import { auditLogKeys, snapshotKeys } from "@/lib/api/query-keys"
import { listSnapshotsBySandboxAction } from "@/lib/api/snapshots-actions"
import type { SandboxStatus } from "@/lib/api/types"
import { formatDate, formatTime } from "@/lib/format"
import { SANDBOX_EVENTS } from "@/lib/posthog/events"

const STATUS_BADGE_VARIANT: Record<SandboxStatus, BadgeVariant> = {
  active: "success",
  pausing: "warning",
  idle: "muted",
  deleted: "destructive",
  failed: "destructive",
}

const STATUS_LABEL: Record<SandboxStatus, string> = {
  active: "Active",
  pausing: "Pausing",
  idle: "Idle",
  deleted: "Deleted",
  failed: "Failed",
}

const ACTIVITY_STATUS_VARIANT: Record<string, BadgeVariant> = {
  success: "success",
  error: "destructive",
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"
  const units = ["B", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / 1024 ** i).toFixed(i > 0 ? 1 : 0)} ${units[i]}`
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "-"
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function DetailSkeleton() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center gap-3 border-b border-border px-6">
        <div className="h-4 w-24 animate-pulse bg-muted/20" />
        <span className="text-muted">/</span>
        <div className="h-4 w-32 animate-pulse bg-muted/20" />
      </div>
      <div className="grid grid-cols-4 border-b border-border">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className={`px-4 py-4 ${i < 3 ? "border-r border-border" : ""}`}
          >
            <div className="mb-2 h-3 w-16 animate-pulse bg-muted/20" />
            <div className="h-4 w-28 animate-pulse bg-muted/20" />
          </div>
        ))}
      </div>
      <div className="flex h-10 items-center border-b border-border px-4">
        <div className="h-3 w-16 animate-pulse bg-muted/20" />
      </div>
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-6 border-b border-border px-4 py-3"
        >
          <div className="h-3 w-24 animate-pulse bg-muted/20" />
          <div className="h-3 w-16 animate-pulse bg-muted/20" />
          <div className="h-3 w-20 animate-pulse bg-muted/20" />
          <div className="h-3 w-12 animate-pulse bg-muted/20" />
        </div>
      ))}
    </div>
  )
}

export default function SandboxDetailPage() {
  const params = useParams<{ sandbox_id: string }>()
  const router = useRouter()
  const posthog = usePostHog()
  const { addToast } = useToast()
  const sandboxId = params.sandbox_id

  const { data: sandbox, isPending, error, refetch } = useSandbox(sandboxId)
  const pauseMutation = usePauseSandbox()
  const resumeMutation = useResumeSandbox()
  const deleteMutation = useDeleteSandbox()

  const { data: activity, isPending: activityPending } = useQuery({
    queryKey: auditLogKeys.bySandbox(sandboxId),
    queryFn: () => listActivityBySandboxAction(sandboxId),
    enabled: !!sandboxId,
  })

  const { data: snapshots, isPending: snapshotsPending } = useQuery({
    queryKey: snapshotKeys.bySandbox(sandboxId),
    queryFn: () => listSnapshotsBySandboxAction(sandboxId),
    enabled: !!sandboxId,
  })

  if (isPending) return <DetailSkeleton />

  if (error || !sandbox) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex h-14 items-center gap-3 border-b border-border px-6">
          <Link
            href="/sandboxes/"
            className="flex items-center gap-1.5 text-sm text-muted hover:text-foreground"
          >
            <ArrowLeftIcon className="size-3.5" weight="light" />
            Sandboxes
          </Link>
        </div>
        <ErrorState
          message={error?.message ?? "Sandbox not found"}
          onRetry={() => refetch()}
        />
      </div>
    )
  }

  const handleCopyIp = async () => {
    if (!sandbox.ip_address) return
    await navigator.clipboard.writeText(sandbox.ip_address)
    addToast("Copied to clipboard", "success")
  }

  const handleDelete = () => {
    posthog.capture(SANDBOX_EVENTS.DELETED, { id: sandbox.id })
    deleteMutation.mutate(sandbox.id, {
      onSuccess: () => router.push("/sandboxes/"),
    })
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-14 items-center justify-between border-b border-border px-6">
        <div className="flex items-center gap-3">
          <Link
            href="/sandboxes/"
            className="flex items-center gap-1.5 text-sm text-muted hover:text-foreground"
          >
            <ArrowLeftIcon className="size-3.5" weight="light" />
            Sandboxes
          </Link>
          <span className="text-muted">/</span>
          <h1 className="font-mono text-sm font-medium text-foreground">
            {sandbox.name}
          </h1>
          <Badge variant={STATUS_BADGE_VARIANT[sandbox.status]} dot>
            {STATUS_LABEL[sandbox.status]}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {(sandbox.status === "active" || sandbox.status === "idle") && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push(`/sandboxes/${sandboxId}/terminal/`)}
            >
              <TerminalIcon className="size-3.5" weight="light" />
              Terminal
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={sandbox.status === "pausing" || sandbox.status === "failed"}
            onClick={() => {
              if (sandbox.status === "active") {
                pauseMutation.mutate(sandbox.id)
              } else if (sandbox.status === "idle") {
                resumeMutation.mutate(sandbox.id)
              }
            }}
          >
            {sandbox.status === "active" || sandbox.status === "pausing" ? (
              <>
                <StopIcon className="size-3.5" weight="light" />
                Stop
              </>
            ) : (
              <>
                <PlayIcon className="size-3.5" weight="light" />
                Start
              </>
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={handleDelete}
          >
            <TrashIcon className="size-3.5" weight="light" />
            Delete
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Info Grid — flat blocks with borders between them */}
        <div className="grid grid-cols-4 border-b border-border">
          <div className="border-r border-border px-4 py-4">
            <p className="text-xs text-muted">Resources</p>
            <p className="mt-2 text-sm text-foreground/80">
              {sandbox.vcpu_count} vCPU &middot; {sandbox.memory_mib} MB
            </p>
          </div>
          <div className="border-r border-border px-4 py-4">
            <p className="text-xs text-muted">IP Address</p>
            <div className="mt-2 flex items-center gap-1.5">
              <p className="font-mono text-sm text-foreground/80">
                {sandbox.ip_address ?? "Not assigned"}
              </p>
              {sandbox.ip_address && (
                <button
                  type="button"
                  onClick={handleCopyIp}
                  className="text-muted hover:text-foreground"
                  aria-label="Copy IP address"
                >
                  <CopyIcon className="size-3.5" weight="light" />
                </button>
              )}
            </div>
          </div>
          <div className="border-r border-border px-4 py-4">
            <p className="text-xs text-muted">Snapshot</p>
            <p className="mt-2 font-mono text-sm text-foreground/80">
              {sandbox.snapshot_id
                ? `${sandbox.snapshot_id.slice(0, 12)}...`
                : "None"}
            </p>
          </div>
          <div className="px-4 py-4">
            <p className="text-xs text-muted">Created</p>
            <p className="mt-2 text-sm text-foreground/80">
              {formatDate(new Date(sandbox.created_at))}
            </p>
          </div>
        </div>

        {/* Activity Section */}
        <div className="flex h-10 items-center border-b border-border px-4">
          <h2 className="text-sm font-medium text-foreground">Activity</h2>
        </div>
        {activityPending ? (
          <div className="border-b border-border">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-6 border-b border-border px-4 py-3 last:border-b-0"
              >
                <div className="h-3 w-24 animate-pulse bg-muted/20" />
                <div className="h-3 w-16 animate-pulse bg-muted/20" />
                <div className="h-3 w-20 animate-pulse bg-muted/20" />
                <div className="h-3 w-12 animate-pulse bg-muted/20" />
              </div>
            ))}
          </div>
        ) : !activity || activity.length === 0 ? (
          <div className="border-b border-border">
            <EmptyState
              icon={ClipboardTextIcon}
              title="No Activity"
              description="Activity will appear here when you run commands or change sandbox state."
            />
          </div>
        ) : (
          <div className="max-h-96 overflow-y-auto border-b border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[22%]">Time</TableHead>
                  <TableHead className="w-[15%]">Category</TableHead>
                  <TableHead className="w-[20%]">Action</TableHead>
                  <TableHead className="w-[12%]">Duration</TableHead>
                  <TableHead className="w-[12%]">Status</TableHead>
                </TableRow>
              </TableHeader>
              <StickyHoverTableBody>
                {activity.map((entry) => {
                  const { relative, absolute } = formatTime(
                    new Date(entry.created_at),
                  )
                  return (
                    <TableRow key={entry.id}>
                      <TableCell className="whitespace-nowrap">
                        <span className="text-foreground/80">{relative}</span>
                        <span className="ml-2 text-xs text-muted">
                          {absolute}
                        </span>
                      </TableCell>
                      <TableCell className="capitalize text-muted">
                        {entry.category}
                      </TableCell>
                      <TableCell className="text-foreground/80">
                        {entry.action}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted">
                        {formatDuration(entry.duration_ms)}
                      </TableCell>
                      <TableCell>
                        {entry.status ? (
                          entry.error ? (
                            <Tooltip>
                              <TooltipTrigger
                                render={
                                  <Badge
                                    variant={
                                      ACTIVITY_STATUS_VARIANT[entry.status] ??
                                      "muted"
                                    }
                                    dot
                                    className="cursor-default"
                                  />
                                }
                              >
                                {entry.status}
                              </TooltipTrigger>
                              <TooltipPopup className="max-w-xs text-xs">
                                {entry.error}
                              </TooltipPopup>
                            </Tooltip>
                          ) : (
                            <Badge
                              variant={
                                ACTIVITY_STATUS_VARIANT[entry.status] ?? "muted"
                              }
                              dot
                            >
                              {entry.status}
                            </Badge>
                          )
                        ) : (
                          <span className="text-muted">-</span>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </StickyHoverTableBody>
            </Table>
          </div>
        )}

        {/* Snapshots Section */}
        <div className="flex h-10 items-center border-b border-border px-4">
          <h2 className="text-sm font-medium text-foreground">Snapshots</h2>
        </div>
        {snapshotsPending ? (
          <div>
            {Array.from({ length: 2 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-6 border-b border-border px-4 py-3 last:border-b-0"
              >
                <div className="h-3 w-32 animate-pulse bg-muted/20" />
                <div className="h-3 w-16 animate-pulse bg-muted/20" />
                <div className="h-3 w-16 animate-pulse bg-muted/20" />
                <div className="h-3 w-20 animate-pulse bg-muted/20" />
              </div>
            ))}
          </div>
        ) : !snapshots || snapshots.length === 0 ? (
          <EmptyState
            icon={CameraIcon}
            title="No Snapshots"
            description="Snapshots are created when you pause this sandbox to preserve its state."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[35%]">Name</TableHead>
                <TableHead className="w-[15%]">Size</TableHead>
                <TableHead className="w-[15%]">Trigger</TableHead>
                <TableHead className="w-[10%]">Saved</TableHead>
                <TableHead className="w-[25%]">Created</TableHead>
              </TableRow>
            </TableHeader>
            <StickyHoverTableBody>
              {snapshots.map((snapshot) => (
                <TableRow key={snapshot.id}>
                  <TableCell className="font-mono text-foreground/80">
                    {snapshot.name ?? `${snapshot.id.slice(0, 12)}...`}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted">
                    {formatBytes(snapshot.size_bytes)}
                  </TableCell>
                  <TableCell className="capitalize text-foreground/80">
                    {snapshot.trigger}
                  </TableCell>
                  <TableCell>
                    <Badge variant={snapshot.saved ? "success" : "muted"} dot>
                      {snapshot.saved ? "Yes" : "No"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted">
                    {formatDate(new Date(snapshot.created_at))}
                  </TableCell>
                </TableRow>
              ))}
            </StickyHoverTableBody>
          </Table>
        )}
      </div>
    </div>
  )
}
