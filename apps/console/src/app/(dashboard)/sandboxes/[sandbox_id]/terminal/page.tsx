"use client"

import { ArrowLeftIcon, PlayIcon, StopIcon } from "@phosphor-icons/react"
import { Badge, Button } from "@superserve/ui"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { ErrorState } from "@/components/error-state"
import { SandboxTerminal } from "@/components/sandboxes/terminal"
import {
  usePauseSandbox,
  useResumeSandbox,
  useSandbox,
} from "@/hooks/use-sandboxes"
import { STATUS_BADGE_VARIANT, STATUS_LABEL } from "@/lib/sandbox-utils"

function TerminalSkeleton() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center gap-3 border-b border-border px-6">
        <div className="h-4 w-24 animate-pulse bg-muted/20" />
        <span className="text-muted">/</span>
        <div className="h-4 w-32 animate-pulse bg-muted/20" />
        <span className="text-muted">/</span>
        <div className="h-4 w-20 animate-pulse bg-muted/20" />
      </div>
      <div className="flex-1 bg-background" />
    </div>
  )
}

export default function TerminalPage() {
  const params = useParams<{ sandbox_id: string }>()
  const sandboxId = params.sandbox_id

  const router = useRouter()
  const { data: sandbox, isPending, error, refetch } = useSandbox(sandboxId)
  const pauseMutation = usePauseSandbox()
  const resumeMutation = useResumeSandbox()

  if (isPending) return <TerminalSkeleton />

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

  const canRun = sandbox.status === "active" || sandbox.status === "paused"

  return (
    <div className="flex h-full flex-col">
      <div className="sticky top-0 z-10 flex h-14 shrink-0 items-center justify-between border-b border-border bg-background px-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            className="flex cursor-pointer items-center gap-1.5 text-sm text-muted hover:text-foreground"
          >
            <ArrowLeftIcon className="size-3.5" weight="light" />
          </button>
          <Link
            href="/sandboxes/"
            className="text-sm text-muted hover:text-foreground"
          >
            Sandboxes
          </Link>
          <span className="text-muted">/</span>
          <Link
            href={`/sandboxes/${sandboxId}/`}
            className="font-mono text-sm text-muted hover:text-foreground"
          >
            {sandbox.name}
          </Link>
          <span className="text-muted">/</span>
          <h1 className="text-sm font-medium text-foreground">Terminal</h1>
          <Badge variant={STATUS_BADGE_VARIANT[sandbox.status]} dot>
            {STATUS_LABEL[sandbox.status]}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={sandbox.status === "resuming"}
            onClick={() => {
              if (sandbox.status === "active") pauseMutation.mutate(sandbox.id)
              else if (sandbox.status === "paused")
                resumeMutation.mutate(sandbox.id)
            }}
          >
            {sandbox.status === "active" ? (
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
        </div>
      </div>

      {canRun ? (
        <SandboxTerminal
          sandboxId={sandboxId}
          accessToken={sandbox.access_token}
        />
      ) : (
        <ErrorState
          message="Sandbox is not running. Start it to use the terminal."
          suggestion="Click the Start button above to resume the sandbox."
        />
      )}
    </div>
  )
}
