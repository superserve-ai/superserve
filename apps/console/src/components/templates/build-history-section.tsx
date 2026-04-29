"use client"

import { CaretDownIcon, ClockCounterClockwiseIcon } from "@phosphor-icons/react"
import { cn } from "@superserve/ui"
import { useState } from "react"
import { EmptyState } from "@/components/empty-state"
import { useTemplateBuilds } from "@/hooks/use-templates"
import { formatTime } from "@/lib/format"
import { formatBuildError } from "@/lib/templates/format-build-error"
import { BuildLogViewer } from "./build-log-viewer"
import { TemplateStatusBadge } from "./template-status-badge"

const TERMINAL = new Set(["ready", "failed", "cancelled"])

export function BuildHistorySection({ templateId }: { templateId: string }) {
  const { data, isPending } = useTemplateBuilds(templateId)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const historical = (data ?? []).filter((b) => TERMINAL.has(b.status))

  return (
    <>
      <div className="flex h-10 items-center border-b border-border px-4">
        <h2 className="text-sm font-medium text-foreground">Build history</h2>
      </div>
      {isPending ? (
        <div className="border-b border-border">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-6 border-b border-border px-4 py-3 last:border-b-0"
            >
              <div className="h-3 w-16 animate-pulse bg-muted/20" />
              <div className="h-3 w-24 animate-pulse bg-muted/20" />
              <div className="h-3 w-32 animate-pulse bg-muted/20" />
            </div>
          ))}
        </div>
      ) : historical.length === 0 ? (
        <div className="border-b border-border py-10">
          <EmptyState
            icon={ClockCounterClockwiseIcon}
            title="No build history"
            description="Previous builds will appear here once they complete."
          />
        </div>
      ) : (
        <div className="border-b border-border">
          {historical.map((build) => {
            const expanded = expandedId === build.id
            const err =
              build.status === "failed"
                ? formatBuildError(build.error_message)
                : null
            const when = build.started_at ?? build.created_at
            const formatted = formatTime(new Date(when))

            return (
              <div
                key={build.id}
                className="border-b border-border last:border-b-0"
              >
                <button
                  type="button"
                  onClick={() =>
                    setExpandedId((prev) =>
                      prev === build.id ? null : build.id,
                    )
                  }
                  className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-foreground/4"
                >
                  <CaretDownIcon
                    className={cn(
                      "size-3.5 shrink-0 text-muted transition-transform",
                      expanded ? "" : "-rotate-90",
                    )}
                    weight="light"
                  />
                  <TemplateStatusBadge status={build.status} />
                  <span
                    className="font-mono text-xs text-muted tabular-nums"
                    title={formatted.absolute}
                  >
                    {formatted.relative}
                  </span>
                  {err && (
                    <span className="truncate font-mono text-xs text-destructive">
                      {err.title}
                    </span>
                  )}
                </button>
                {expanded && (
                  <div className="border-t border-border bg-surface/30 p-4">
                    <BuildLogViewer
                      templateId={templateId}
                      buildId={build.id}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
