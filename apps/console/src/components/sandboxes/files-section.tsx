"use client"

import { FilesIcon, PlayIcon } from "@phosphor-icons/react"
import { Button } from "@superserve/ui"

import { useImpersonation } from "@/components/admin/impersonation-context"
import type { SandboxResponse } from "@/lib/api/types"

import { FileBrowser } from "./files/file-browser"

function disabledReason(status: SandboxResponse["status"]): string {
  switch (status) {
    case "paused":
      return "Start the sandbox to browse files"
    case "resuming":
      return "Sandbox is resuming"
    default:
      return "Files unavailable"
  }
}

interface FilesSectionProps {
  sandbox: SandboxResponse
  onStart?: () => void
}

export function FilesSection({ sandbox, onStart }: FilesSectionProps) {
  const { isImpersonating } = useImpersonation()
  const isActive = sandbox.status === "active"

  // The file browser's upload/download talk directly to the data plane (boxd-…),
  // bypassing the read-only proxy gate, and the proxy redacts the access_token
  // they need while impersonating. Surface a clear read-only state instead of a
  // browser whose actions would silently fail.
  if (isImpersonating) {
    return (
      <section className="border-b border-border">
        <div className="flex h-10 items-center border-b border-border px-4">
          <h2 className="text-sm font-semibold text-foreground">Files</h2>
        </div>
        <FilesEmptyState
          status={sandbox.status}
          reason="File browsing is disabled while viewing another team"
        />
      </section>
    )
  }

  return (
    <section className="border-b border-border">
      <div className="flex h-10 items-center border-b border-border px-4">
        <h2 className="text-sm font-semibold text-foreground">Files</h2>
      </div>
      {isActive ? (
        <FileBrowser sandbox={sandbox} />
      ) : (
        <FilesEmptyState status={sandbox.status} onStart={onStart} />
      )}
    </section>
  )
}

function FilesEmptyState({
  status,
  onStart,
  reason,
}: {
  status: SandboxResponse["status"]
  onStart?: () => void
  reason?: string
}) {
  return (
    <div className="flex min-h-[180px] flex-col items-center justify-center gap-4 px-6 py-12">
      <FilesIcon className="size-8 text-muted" weight="light" />
      <div className="flex flex-col items-center gap-1.5">
        <p className="font-mono text-sm text-foreground/60">
          {reason ?? disabledReason(status)}
        </p>
        {status === "paused" && onStart && (
          <Button size="sm" onClick={onStart} className="mt-3">
            <PlayIcon className="size-3.5" weight="light" />
            Start sandbox
          </Button>
        )}
      </div>
    </div>
  )
}
