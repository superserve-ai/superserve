"use client"

import {
  ArrowLeftIcon,
  PlayIcon,
  StopIcon,
  TerminalIcon,
  TrashIcon,
} from "@phosphor-icons/react"
import { Badge, Button } from "@superserve/ui"
import { useQuery } from "@tanstack/react-query"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { usePostHog } from "posthog-js/react"
import { ErrorState } from "@/components/error-state"
import { ActivitySection } from "@/components/sandboxes/activity-section"
import {
  MetadataSection,
  NetworkSection,
  SandboxInfoGrid,
} from "@/components/sandboxes/sandbox-info-grid"
import { SnapshotsSection } from "@/components/sandboxes/snapshots-section"
import {
  useDeleteSandbox,
  usePauseSandbox,
  useResumeSandbox,
  useSandbox,
} from "@/hooks/use-sandboxes"
import { listActivityBySandboxAction } from "@/lib/api/activity-actions"
import { auditLogKeys, snapshotKeys } from "@/lib/api/query-keys"
import { listSnapshotsBySandboxAction } from "@/lib/api/snapshots-actions"
import { SANDBOX_EVENTS } from "@/lib/posthog/events"
import { STATUS_BADGE_VARIANT, STATUS_LABEL } from "@/lib/sandbox-utils"

function DetailSkeleton() {
  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-14 items-center gap-3 border-b border-border px-6">
        <div className="h-4 w-24 animate-pulse bg-muted/20" />
        <span className="text-muted">/</span>
        <div className="h-4 w-32 animate-pulse bg-muted/20" />
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Info grid */}
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

        {/* Network | Metadata */}
        <div className="grid grid-cols-2 border-b border-border">
          <div className="border-r border-border px-4 py-4">
            <div className="mb-3 h-3.5 w-16 animate-pulse bg-muted/20" />
            <div className="flex gap-2">
              <div className="h-6 w-28 animate-pulse bg-muted/20" />
              <div className="h-6 w-20 animate-pulse bg-muted/20" />
            </div>
          </div>
          <div className="px-4 py-4">
            <div className="mb-3 h-3.5 w-16 animate-pulse bg-muted/20" />
            <div className="flex gap-2">
              <div className="h-6 w-24 animate-pulse bg-muted/20" />
              <div className="h-6 w-20 animate-pulse bg-muted/20" />
            </div>
          </div>
        </div>

        {/* Activity */}
        <div className="flex h-10 items-center border-b border-border px-4">
          <div className="h-3.5 w-16 animate-pulse bg-muted/20" />
        </div>
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={`activity-${i}`}
            className="flex items-center gap-6 border-b border-border px-4 py-3"
          >
            <div className="h-3 w-24 animate-pulse bg-muted/20" />
            <div className="h-3 w-16 animate-pulse bg-muted/20" />
            <div className="h-3 w-20 animate-pulse bg-muted/20" />
            <div className="h-3 w-12 animate-pulse bg-muted/20" />
          </div>
        ))}

        {/* Snapshots */}
        <div className="flex h-10 items-center border-b border-border px-4">
          <div className="h-3.5 w-20 animate-pulse bg-muted/20" />
        </div>
        {Array.from({ length: 2 }).map((_, i) => (
          <div
            key={`snapshot-${i}`}
            className="flex items-center gap-6 border-b border-border px-4 py-3"
          >
            <div className="h-3 w-32 animate-pulse bg-muted/20" />
            <div className="h-3 w-16 animate-pulse bg-muted/20" />
            <div className="h-3 w-16 animate-pulse bg-muted/20" />
            <div className="h-3 w-20 animate-pulse bg-muted/20" />
          </div>
        ))}
      </div>
    </div>
  )
}

export default function SandboxDetailPage() {
  const params = useParams<{ sandbox_id: string }>()
  const router = useRouter()
  const posthog = usePostHog()
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
            disabled={
              sandbox.status === "pausing" || sandbox.status === "failed"
            }
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
        <SandboxInfoGrid sandbox={sandbox} />
        <div className="grid grid-cols-2 border-b border-border">
          <div className="border-r border-border">
            <NetworkSection sandbox={sandbox} />
          </div>
          <MetadataSection sandbox={sandbox} />
        </div>
        <ActivitySection activity={activity} isPending={activityPending} />
        <SnapshotsSection snapshots={snapshots} isPending={snapshotsPending} />
      </div>
    </div>
  )
}
