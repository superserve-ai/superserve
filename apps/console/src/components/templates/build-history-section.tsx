"use client"

import { CaretDownIcon } from "@phosphor-icons/react"
import { cn } from "@superserve/ui"
import { useState } from "react"
import { useTemplateBuilds } from "@/hooks/use-templates"
import { formatTime } from "@/lib/format"
import { formatBuildError } from "@/lib/templates/format-build-error"
import { BuildLogViewer } from "./build-log-viewer"
import { TemplateStatusBadge } from "./template-status-badge"

const TERMINAL = new Set(["ready", "failed", "cancelled"])

export function BuildHistorySection({ templateId }: { templateId: string }) {
  const { data, isPending } = useTemplateBuilds(templateId)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  if (isPending) return null
  const historical = (data ?? []).filter((b) => TERMINAL.has(b.status))
  if (historical.length === 0) return null

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-mono text-[11px] uppercase tracking-wide text-muted">
        Build history
      </h2>
      <ul className="flex flex-col border border-dashed border-border">
        {historical.map((build) => {
          const expanded = expandedId === build.id
          const err =
            build.status === "failed"
              ? formatBuildError(build.error_message)
              : null
          const when = build.started_at ?? build.created_at
          const formatted = formatTime(new Date(when))

          return (
            <li
              key={build.id}
              className="border-b border-dashed border-border last:border-b-0"
            >
              <button
                type="button"
                onClick={() =>
                  setExpandedId((prev) => (prev === build.id ? null : build.id))
                }
                className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-foreground/4"
              >
                <CaretDownIcon
                  className={cn(
                    "size-3.5 shrink-0 transition-transform",
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
                <div className="border-t border-dashed border-border p-4">
                  <BuildLogViewer templateId={templateId} buildId={build.id} />
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
