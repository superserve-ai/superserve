"use client"

import { StopCircleIcon } from "@phosphor-icons/react"
import { Button } from "@superserve/ui"
import {
  useCancelTemplateBuild,
  useTemplateBuilds,
} from "@/hooks/use-templates"
import { formatBuildError } from "@/lib/templates/format-build-error"
import { BuildLogViewer } from "./build-log-viewer"
import { TemplateStatusBadge } from "./template-status-badge"

const IN_FLIGHT = new Set(["pending", "building", "snapshotting"])

export function CurrentBuildPanel({ templateId }: { templateId: string }) {
  const { data: builds } = useTemplateBuilds(templateId)
  const cancel = useCancelTemplateBuild(templateId)

  const latest = builds?.[0]
  if (!latest) return null

  const isInFlight = IN_FLIGHT.has(latest.status)
  // Show the panel for in-flight builds AND for the most recent terminal
  // build if it was a failure — users need to see the error + logs inline.
  if (!isInFlight && latest.status !== "failed") return null

  const err =
    latest.status === "failed" ? formatBuildError(latest.error_message) : null

  return (
    <>
      <div className="flex h-10 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-medium text-foreground">
            {isInFlight ? "Current build" : "Last build"}
          </h2>
          <TemplateStatusBadge status={latest.status} />
        </div>
        {isInFlight && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => cancel.mutate(latest.id)}
            disabled={cancel.isPending}
          >
            <StopCircleIcon className="size-3.5" weight="light" />
            {cancel.isPending ? "Cancelling…" : "Cancel build"}
          </Button>
        )}
      </div>

      <div className="border-b border-border p-4">
        {err && (
          <div className="mb-3 border border-dashed border-destructive/40 p-3">
            <div className="font-mono text-xs uppercase text-destructive">
              {err.title}
            </div>
            {err.detail && (
              <div className="mt-1 font-mono text-xs text-muted">
                {err.detail}
              </div>
            )}
          </div>
        )}
        <BuildLogViewer templateId={templateId} buildId={latest.id} />
      </div>
    </>
  )
}
